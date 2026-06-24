/* ============================================================
   Content Zapper - Core Content Script (v1.2)
   Precision element sniping with persistent zap rules.
   Handles dynamic IDs (Google, GitHub, etc.) via multi-strategy
   fingerprinting so zapped content stays gone across refreshes.
   ============================================================ */

(function ContentZapper() {
  'use strict';

  let isActive = false;
  let hoveredElement = null;
  let undoStack = [];
  let overlay = null;
  let pathBar = null;
  let crosshair = null;
  let toastTimer = null;
  let toastEnabled = true;
  let animationEnabled = true;
  let pathEnabled = true;

  const CZ_PREFIX = 'cz-';
  const hostname = window.location.hostname;

  /* ==========================================================
     1. DYNAMIC ID DETECTION
     IDs like _a5w4au75JryghbIP9uyN4Qk_49, _O504aoqGNqq7hbIP9dHWoAI_47
     are auto-generated hashes that change every page load.
     ========================================================== */

  function isDynamicId(id) {
    if (!id || id.length < 12) return false;
    // Starts with underscore or colon followed by long hash-like string
    if (/^[_:][a-zA-Z0-9]{10,}$/.test(id)) return true;
    // Long mixed-case alphanumeric with underscores, no vowels pattern
    if (id.length >= 15 && /^[a-zA-Z0-9_-]+$/.test(id)) {
      const hasUpper = /[A-Z]/.test(id);
      const hasDigit = /[0-9]/.test(id);
      const hasUnder = /_/.test(id);
      if (hasUpper && hasDigit && hasUnder) return true;
      // Very long ID with no human-readable words
      if (id.length >= 20) return true;
    }
    return false;
  }

  /* ==========================================================
     2. STABLE SELECTOR GENERATION
     Strips dynamic IDs and creates alternative selectors that
     survive page refreshes on sites like Google, GitHub, etc.
     ========================================================== */

  function stripDynamicIds(selector) {
    return selector.replace(/#[a-zA-Z0-9_-]+/g, (match) => {
      const id = match.substring(1);
      return isDynamicId(id) ? '' : match;
    }).replace(/\s*>\s*>\s*/g, ' > ').replace(/\s+/g, ' ').trim();
  }

  function generateClassSelector(el) {
    if (!el.classList || el.classList.length === 0) return '';
    const classes = [];
    for (const cls of el.classList) {
      if (!cls.startsWith(CZ_PREFIX)) classes.push(cls);
    }
    return el.tagName.toLowerCase() + '.' + classes.join('.');
  }

  function getElementSelector(el) {
    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      if (current.id && !isDynamicId(current.id)) {
        selector += '#' + CSS.escape(current.id);
        parts.unshift(selector);
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/)
          .filter(c => c && !c.startsWith(CZ_PREFIX))
          .slice(0, 2);
        if (classes.length > 0) {
          selector += '.' + classes.map(c => CSS.escape(c)).join('.');
        }
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          selector += ':nth-child(' + (siblings.indexOf(current) + 1) + ')';
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  /* ==========================================================
     3. ELEMENT FINGERPRINTING
     Creates multiple matching strategies for each zapped element
     so we can find it again even when IDs change.
     ========================================================== */

  function getRelevantText(el) {
    // Get text content of direct children only (not deep descendants)
    let text = '';
    for (const child of el.children) {
      text += child.textContent || '';
    }
    // Also get the element's own direct text
    const ownText = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .filter(t => t.length > 0)
      .join(' ');
    const combined = (ownText + ' ' + text).replace(/\s+/g, ' ').trim();
    return combined.substring(0, 200);
  }

  function getAttributeFingerprint(el) {
    const attrs = {};
    const interesting = ['role', 'data-testid', 'aria-label', 'aria-describedby',
      'data-component', 'data-slot', 'id', 'class', 'type', 'name', 'placeholder',
      'data-id', 'data-qa', 'data-cy'];
    for (const attr of interesting) {
      const val = el.getAttribute(attr);
      if (val) attrs[attr] = val;
    }
    return attrs;
  }

  function getStructuralFingerprint(el) {
    const parent = el.parentElement;
    return {
      tagName: el.tagName.toLowerCase(),
      childCount: el.children.length,
      siblingIndex: parent ? Array.from(parent.children).indexOf(el) : -1,
      depth: getDomDepth(el),
      parentClasses: parent ? Array.from(parent.classList).filter(c => !c.startsWith(CZ_PREFIX)).slice(0, 3) : [],
      hasText: el.textContent.trim().length > 0,
      hasImages: el.querySelectorAll('img').length > 0,
      hasLinks: el.querySelectorAll('a').length > 0,
      isFixed: getComputedStyle(el).position === 'fixed' || getComputedStyle(el).position === 'sticky',
      isPositioned: getComputedStyle(el).position !== 'static'
    };
  }

  function getDomDepth(el) {
    let depth = 0;
    let current = el;
    while (current && current !== document.documentElement) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }

  function generateFingerprint(el) {
    const selector = getElementSelector(el);
    const stableSelector = stripDynamicIds(selector);
    const text = getRelevantText(el);
    const attrs = getAttributeFingerprint(el);
    const structure = getStructuralFingerprint(el);
    const classes = Array.from(el.classList).filter(c => !c.startsWith(CZ_PREFIX));
    const role = el.getAttribute('role') || '';
    const dataTestId = el.getAttribute('data-testid') || '';

    return {
      selector: selector,
      stableSelector: stableSelector,
      text: text,
      attrs: attrs,
      structure: structure,
      classes: classes,
      role: role,
      dataTestId: dataTestId,
      timestamp: Date.now()
    };
  }

  /* ==========================================================
     4. MULTI-STRATEGY ELEMENT MATCHING
     Tries multiple approaches to find the same element after
     a page refresh when IDs have changed.
     ========================================================== */

  function safeQuery(selector) {
    try { return document.querySelectorAll(selector); }
    catch (e) { return []; }
  }

  function findMatchingElement(fp) {
    // Strategy 1: Exact selector (works for stable pages)
    try {
      const el = document.querySelector(fp.selector);
      if (el && isZappable(el)) return el;
    } catch (e) {}

    // Strategy 2: Stable selector (dynamic IDs stripped)
    if (fp.stableSelector && fp.stableSelector !== fp.selector) {
      const els = safeQuery(fp.stableSelector);
      if (els.length === 1 && isZappable(els[0])) return els[0];
      if (els.length > 1 && fp.text) {
        for (const el of els) {
          if (el.textContent.trim().includes(fp.text.substring(0, 50)) && isZappable(el)) return el;
        }
      }
    }

    // Strategy 3: data-testid match
    if (fp.dataTestId) {
      const els = safeQuery('[data-testid="' + CSS.escape(fp.dataTestId) + '"]');
      if (els.length === 1 && isZappable(els[0])) return els[0];
    }

    // Strategy 4: Role + class combination
    if (fp.role && fp.classes.length > 0) {
      const classSelector = fp.structure.tagName + '.' + fp.classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
      const els = safeQuery(classSelector + '[role="' + fp.role + '"]');
      if (els.length === 1 && isZappable(els[0])) return els[0];
    }

    // Strategy 5: Class-only selector disambiguated by text
    if (fp.classes.length >= 1) {
      const tag = fp.structure.tagName;
      const classSel = tag + '.' + fp.classes.map(c => CSS.escape(c)).join('.');
      const els = safeQuery(classSel);
      if (els.length > 0 && fp.text) {
        for (const el of els) {
          if (el.textContent.trim().includes(fp.text.substring(0, 60)) && isZappable(el)) return el;
        }
      }
      if (els.length === 1 && isZappable(els[0])) return els[0];
    }

    // Strategy 6: Text content scan (last resort, expensive)
    if (fp.text && fp.text.length > 5) {
      const tag = fp.structure.tagName;
      const candidates = safeQuery(tag);
      for (const el of candidates) {
        if (!isZappable(el)) continue;
        if (el.textContent.trim().includes(fp.text.substring(0, 80))) {
          // Verify structural similarity
          const depth = getDomDepth(el);
          if (Math.abs(depth - fp.structure.depth) <= 3) return el;
        }
      }
    }

    return null;
  }

  /* ==========================================================
     5. PERSISTENT ZAP APPLICATION
     On page load, fetch stored rules for this domain and
     auto-zap any elements that match.
     ========================================================== */

  async function applyPersistentZaps() {
    try {
      const response = await browser.runtime.sendMessage({ type: 'getZapRules', domain: hostname });
      if (!response || !response.rules || response.rules.length === 0) return;

      let matched = 0;
      for (const rule of response.rules) {
        // Skip disabled rules
        if (rule.disabled) continue;

        const fp = rule.fingerprint;
        const el = findMatchingElement(fp);

        if (el && isZappable(el)) {
          el.style.display = 'none';
          el.setAttribute('data-cz-persist-zapped', 'true');
          matched++;
        }
      }

      if (matched > 0 && toastEnabled) {
        showToast(matched + ' persistent zap' + (matched > 1 ? 's' : '') + ' applied');
      }
    } catch (e) {
      // Extension context may not be ready
    }
  }

  // Delayed apply to let the page fully render
  setTimeout(applyPersistentZaps, 800);
  // Second pass for SPAs that render late
  setTimeout(applyPersistentZaps, 3000);

  /* ==========================================================
     6. HELPERS
     ========================================================== */

  function isOurElement(el) {
    if (!el || !el.classList) return false;
    for (const cls of el.classList) {
      if (cls.startsWith(CZ_PREFIX)) return true;
    }
    return false;
  }

  function isZappable(el) {
    if (!el || el === document.documentElement || el === document.body) return false;
    if (isOurElement(el)) return false;
    if (el.nodeType !== Node.ELEMENT_NODE) return false;
    return true;
  }

  function getElementType(el) { return el.tagName.toLowerCase(); }

  function getElementSize(el) {
    const rect = el.getBoundingClientRect();
    return Math.round(rect.width) + ' x ' + Math.round(rect.height);
  }

  function getDeepestElementAtPoint(x, y) {
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
      if (isZappable(el)) return el;
    }
    return null;
  }

  /* ==========================================================
     7. OVERLAY MANAGEMENT
     ========================================================== */

  function createOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'cz-highlight-overlay';
    document.body.appendChild(overlay);
  }

  function removeOverlay() {
    if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
    overlay = null;
  }

  function positionOverlay(el) {
    if (!overlay || !el) return;
    const rect = el.getBoundingClientRect();
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  }

  function hideOverlay() {
    if (overlay) {
      overlay.style.left = '-9999px';
      overlay.style.top = '-9999px';
      overlay.style.width = '0';
      overlay.style.height = '0';
    }
  }

  /* ==========================================================
     8. PATH BAR
     ========================================================== */

  function createPathBar() {
    if (pathBar) return;
    pathBar = document.createElement('div');
    pathBar.className = 'cz-element-path';
    document.body.appendChild(pathBar);
  }

  function removePathBar() {
    if (pathBar && pathBar.parentElement) pathBar.parentElement.removeChild(pathBar);
    pathBar = null;
  }

  function updatePathBar(el) {
    if (!pathBar || !el || !pathEnabled) return;
    const tag = getElementType(el);
    const id = el.id ? '#' + CSS.escape(el.id) : '';
    const classes = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/)
          .filter(c => c && !c.startsWith(CZ_PREFIX))
          .slice(0, 3)
          .map(c => CSS.escape(c))
          .join('.')
      : '';

    // Clear and rebuild using DOM API (no innerHTML)
    pathBar.textContent = '';

    const tagSpan = document.createElement('span');
    tagSpan.className = 'cz-element-path-tag';
    tagSpan.textContent = '<' + tag + '>';
    pathBar.appendChild(tagSpan);

    if (id) {
      const sep1 = document.createElement('span');
      sep1.className = 'cz-element-path-sep';
      sep1.textContent = ' ';
      pathBar.appendChild(sep1);
      const idSpan = document.createElement('span');
      idSpan.className = 'cz-element-path-id';
      idSpan.textContent = id;
      pathBar.appendChild(idSpan);
    }

    if (classes) {
      const sep2 = document.createElement('span');
      sep2.className = 'cz-element-path-sep';
      sep2.textContent = ' ';
      pathBar.appendChild(sep2);
      const clsSpan = document.createElement('span');
      clsSpan.className = 'cz-element-path-class';
      clsSpan.textContent = classes;
      pathBar.appendChild(clsSpan);
    }

    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'cz-element-path-size';
    sizeSpan.textContent = getElementSize(el);
    pathBar.appendChild(sizeSpan);

    const hintSpan = document.createElement('span');
    hintSpan.className = 'cz-element-path-hint';
    hintSpan.textContent = 'Click to zap \u00B7 Esc to exit';
    pathBar.appendChild(hintSpan);
  }

  /* ==========================================================
     9. CROSSHAIR
     ========================================================== */

  function createCrosshair() {
    if (crosshair) return;
    crosshair = document.createElement('div');
    crosshair.className = 'cz-crosshair';
    crosshair.style.display = 'none';
    document.body.appendChild(crosshair);
  }

  function removeCrosshair() {
    if (crosshair && crosshair.parentElement) crosshair.parentElement.removeChild(crosshair);
    crosshair = null;
  }

  function moveCrosshair(x, y) {
    if (!crosshair) return;
    crosshair.style.display = 'block';
    crosshair.style.left = x + 'px';
    crosshair.style.top = y + 'px';
  }

  /* ==========================================================
     10. TOAST
     ========================================================== */

  function showToast(message, duration) {
    if (!toastEnabled) return;
    duration = duration || 2000;
    const existing = document.querySelector('.cz-toast');
    if (existing) existing.remove();
    if (toastTimer) clearTimeout(toastTimer);
    const toast = document.createElement('div');
    toast.className = 'cz-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => { if (toast.parentElement) toast.remove(); }, 200);
    }, duration);
  }

  /* ==========================================================
     11. UNDO BADGE
     ========================================================== */

  let undoBadge = null;

  function showUndoBadge() {
    if (undoBadge) return;
    undoBadge = document.createElement('div');
    undoBadge.className = 'cz-undo-badge';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'cz-undo-badge-icon';
    iconSpan.textContent = '\u21CE';
    undoBadge.appendChild(iconSpan);
    undoBadge.appendChild(document.createTextNode(' Undo (Alt+Shift+Z)'));
    undoBadge.addEventListener('click', handleUndo);
    document.body.appendChild(undoBadge);
  }

  function hideUndoBadge() {
    if (undoBadge && undoBadge.parentElement) undoBadge.parentElement.removeChild(undoBadge);
    undoBadge = null;
  }

  /* ==========================================================
     12. CORE ZAP / UNDO
     ========================================================== */

  function zapElement(el) {
    if (!isZappable(el)) return;

    const parent = el.parentElement;
    const nextSibling = el.nextSibling;

    undoStack.push({
      element: el,
      parent: parent,
      nextSibling: nextSibling,
      display: el.style.display,
      visibility: el.style.visibility
    });

    if (animationEnabled) {
      el.classList.add('cz-zap-out');
      setTimeout(() => {
        el.style.display = 'none';
        el.classList.remove('cz-zap-out');
      }, 250);
    } else {
      el.style.display = 'none';
    }

    showUndoBadge();

    const fp = generateFingerprint(el);
    const selector = fp.selector;
    showToast('Zapped: ' + getElementType(el).toUpperCase());

    // Send to background with fingerprint for persistent storage
    try {
      browser.runtime.sendMessage({
        type: 'zap',
        selector: selector,
        tag: getElementType(el),
        fingerprint: fp,
        domain: hostname
      });
    } catch (e) {}
  }

  function handleUndo() {
    if (undoStack.length === 0) {
      showToast('Nothing to undo');
      return;
    }
    const entry = undoStack.pop();
    const el = entry.element;
    if (entry.nextSibling) {
      entry.parent.insertBefore(el, entry.nextSibling);
    } else {
      entry.parent.appendChild(el);
    }
    el.style.display = entry.display || '';
    el.style.visibility = entry.visibility || '';
    showToast('Restored: ' + getElementType(el).toUpperCase());
    if (undoStack.length === 0) hideUndoBadge();
    try { browser.runtime.sendMessage({ type: 'undo' }); } catch (e) {}
  }

  /* ==========================================================
     13. BLACKLIST AUTO-ZAP
     ========================================================== */

  function applyBlacklist(selectors) {
    if (!Array.isArray(selectors)) return;
    selectors.forEach(sel => {
      try {
        const matches = document.querySelectorAll(sel);
        matches.forEach(el => { if (isZappable(el)) el.style.display = 'none'; });
      } catch (e) {}
    });
  }

  async function loadAndApplyBlacklist() {
    try {
      const response = await browser.runtime.sendMessage({ type: 'getBlacklist' });
      if (response && response.blacklist) applyBlacklist(response.blacklist);
    } catch (e) {}
  }

  /* ==========================================================
     14. USER PREFERENCES
     ========================================================== */

  async function loadPrefs() {
    try {
      const result = await browser.storage.local.get(['showPath', 'showToast', 'animation']);
      toastEnabled = result.showToast !== false;
      animationEnabled = result.animation !== false;
      pathEnabled = result.showPath !== false;
    } catch (e) {}
  }

  /* ==========================================================
     15. ACTIVATE / DEACTIVATE
     ========================================================== */

  function activate() {
    if (isActive) return;
    isActive = true;
    document.body.classList.add('cz-zapper-active');
    createOverlay();
    createPathBar();
    createCrosshair();
    showToast('Zapper active');
    try { browser.runtime.sendMessage({ type: 'activated' }); } catch (e) {}
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    document.body.classList.remove('cz-zapper-active');
    removeOverlay();
    removePathBar();
    removeCrosshair();
    hoveredElement = null;
    showToast('Zapper off');
    try { browser.runtime.sendMessage({ type: 'deactivated' }); } catch (e) {}
  }

  function toggle() {
    isActive ? deactivate() : activate();
  }

  /* ==========================================================
     16. EVENT HANDLERS
     ========================================================== */

  function onMouseMove(e) {
    if (!isActive) return;
    moveCrosshair(e.clientX, e.clientY);
    const target = getDeepestElementAtPoint(e.clientX, e.clientY);
    if (target !== hoveredElement) {
      hoveredElement = target;
      if (target && isZappable(target)) {
        positionOverlay(target);
        updatePathBar(target);
      } else {
        hideOverlay();
      }
    }
  }

  function onMouseClick(e) {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const target = getDeepestElementAtPoint(e.clientX, e.clientY);
    if (target && isZappable(target)) {
      zapElement(target);
      hoveredElement = null;
      hideOverlay();
    }
  }

  function onKeyDown(e) {
    if (!isActive) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      deactivate();
    }
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      handleUndo();
    }
  }

  function onPointerDown(e) {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();
  }

  /* ==========================================================
     17. MESSAGE HANDLING
     ========================================================== */

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onMouseClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'toggle':
        toggle();
        sendResponse({ active: isActive });
        break;
      case 'activate':
        activate();
        sendResponse({ active: true });
        break;
      case 'deactivate':
        deactivate();
        sendResponse({ active: false });
        break;
      case 'undo':
        handleUndo();
        sendResponse({ undone: true });
        break;
      case 'getStatus':
        sendResponse({ active: isActive, undoCount: undoStack.length });
        break;
      case 'applyBlacklist':
        loadAndApplyBlacklist();
        sendResponse({ ok: true });
        break;
      case 'applyPersistentZaps':
        applyPersistentZaps();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ error: 'Unknown message type' });
    }
    return true;
  });

  /* ==========================================================
     18. INIT
     ========================================================== */

  loadPrefs();
  loadAndApplyBlacklist();

})();
