/* ============================================================
   Content Zapper - Unified Control Panel (v1.3)
   Single page with Dashboard + Settings tabs.
   ============================================================ */

(function ControlPanel() {
  'use strict';

  // ---- Shared elements ----
  const toastEl = document.getElementById('toast');
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modalTitle');
  const modalMsg = document.getElementById('modalMsg');
  const modalConfirm = document.getElementById('modalConfirm');
  const modalCancel = document.getElementById('modalCancel');

  let modalResolve = null;

  // ---- Shared helpers ----
  function showToast(msg, ms) {
    ms = ms || 2000;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  function showConfirm(title, msg) {
    modalTitle.textContent = title;
    modalMsg.textContent = msg;
    modal.classList.add('show');
    return new Promise(resolve => { modalResolve = resolve; });
  }

  // Modal events
  modalConfirm.addEventListener('click', () => {
    modal.classList.remove('show');
    if (modalResolve) modalResolve(true);
    modalResolve = null;
  });
  modalCancel.addEventListener('click', () => {
    modal.classList.remove('show');
    if (modalResolve) modalResolve(false);
    modalResolve = null;
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('show');
      if (modalResolve) modalResolve(false);
      modalResolve = null;
    }
  });

  // ==========================================================
  // MAIN TAB SWITCHING (Dashboard / Settings)
  // ==========================================================

  const mainTabs = document.querySelectorAll('.main-tab');
  const panelDashboard = document.getElementById('panelDashboard');
  const panelSettings = document.getElementById('panelSettings');
  const dashCount = document.getElementById('dashCount');

  function switchMainTab(tabName) {
    mainTabs.forEach(t => t.classList.toggle('active', t.dataset.panel === tabName));
    panelDashboard.classList.toggle('active', tabName === 'dashboard');
    panelSettings.classList.toggle('active', tabName === 'settings');
    dashCount.style.display = tabName === 'dashboard' ? '' : 'none';
    // Update URL hash for bookmarkability
    history.replaceState(null, '', '#' + tabName);
  }

  mainTabs.forEach(btn => {
    btn.addEventListener('click', () => switchMainTab(btn.dataset.panel));
  });

  // On load, check hash to determine initial tab
  function initTabFromHash() {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'settings') {
      switchMainTab('settings');
    } else {
      switchMainTab('dashboard');
    }
  }

  // ==========================================================
  // DASHBOARD: Data & Rendering
  // ==========================================================

  const siteListEl = document.getElementById('siteList');
  const emptyEl = document.getElementById('emptyState');
  const dashSearchEl = document.getElementById('dashSearch');

  let zapRules = {};
  let zapHistory = {};
  let currentDashTab = 'rules';

  // Sub-tab switching (Persistent Rules / History)
  document.querySelectorAll('.sub-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentDashTab = btn.dataset.tab;
      renderDashboard();
    });
  });

  // Dashboard data
  async function loadDashboardData() {
    try {
      const result = await browser.storage.local.get(['zapRules', 'zapHistory']);
      zapRules = result.zapRules || {};
      zapHistory = result.zapHistory || {};
    } catch (e) {
      zapRules = {};
      zapHistory = {};
    }
    renderDashboard();
  }

  async function saveRules() {
    try { await browser.storage.local.set({ zapRules }); } catch (e) {}
  }

  async function saveHistory() {
    try { await browser.storage.local.set({ zapHistory }); } catch (e) {}
  }

  // Dashboard render (DOM API, no innerHTML)
  function renderDashboard() {
    const data = currentDashTab === 'rules' ? zapRules : zapHistory;
    const query = dashSearchEl.value.trim().toLowerCase();
    const domains = Object.keys(data).filter(d => !query || d.toLowerCase().includes(query));
    domains.sort((a, b) => {
      const getLatest = (arr) => arr.length ? (arr[arr.length - 1].createdAt || arr[arr.length - 1].timestamp || 0) : 0;
      return getLatest(data[b]) - getLatest(data[a]);
    });

    let totalItems = 0;
    domains.forEach(d => totalItems += data[d].length);
    dashCount.textContent = totalItems + (currentDashTab === 'rules' ? ' rule' : ' zap') + (totalItems !== 1 ? 's' : '') + ' total';

    if (domains.length === 0) {
      siteListEl.textContent = '';
      emptyEl.style.display = 'block';
      emptyEl.querySelector('.empty-text').textContent = currentDashTab === 'rules'
        ? 'No persistent rules yet. Zap elements and they\'ll auto-apply on future visits.'
        : 'No zaps recorded yet. Activate the Zapper and start removing elements.';
      return;
    }
    emptyEl.style.display = 'none';

    // Build DOM
    siteListEl.textContent = '';

    domains.forEach(domain => {
      const entries = data[domain];
      const isRules = currentDashTab === 'rules';
      const disabledCount = isRules ? entries.filter(e => e.disabled).length : 0;

      const siteLi = document.createElement('li');
      siteLi.className = 'site-item';
      siteLi.dataset.domain = domain;

      // Header
      const siteHeader = document.createElement('div');
      siteHeader.className = 'site-header';

      const chevron = document.createElement('span');
      chevron.className = 'site-chevron';
      chevron.textContent = '\u25B8';
      siteHeader.appendChild(chevron);

      const domainSpan = document.createElement('span');
      domainSpan.className = 'site-domain';
      domainSpan.textContent = domain;
      siteHeader.appendChild(domainSpan);

      const countSpan = document.createElement('span');
      countSpan.className = 'site-count';
      countSpan.textContent = isRules ? (entries.length - disabledCount) + '/' + entries.length : String(entries.length);
      siteHeader.appendChild(countSpan);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'site-actions';
      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn-icon danger';
      clearBtn.dataset.action = 'clear-site';
      clearBtn.dataset.domain = domain;
      clearBtn.title = 'Clear all for this site';
      clearBtn.textContent = '\u2715';
      actionsDiv.appendChild(clearBtn);
      siteHeader.appendChild(actionsDiv);

      siteLi.appendChild(siteHeader);

      // Zap list
      const zapListUl = document.createElement('ul');
      zapListUl.className = 'zap-list';

      entries.forEach((entry, i) => {
        const time = new Date(entry.createdAt || entry.timestamp).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        const zapLi = document.createElement('li');
        zapLi.className = 'zap-entry';

        if (isRules) {
          const fp = entry.fingerprint || {};
          const hasDynamic = fp.stableSelector && fp.stableSelector !== fp.selector;
          const isDisabled = entry.disabled;
          zapLi.style.opacity = isDisabled ? '0.4' : '1';

          const toggleBtn = document.createElement('button');
          toggleBtn.className = 'btn-toggle' + (isDisabled ? ' off' : '');
          toggleBtn.dataset.action = 'toggle-rule';
          toggleBtn.dataset.domain = domain;
          toggleBtn.dataset.id = entry.id;
          toggleBtn.title = isDisabled ? 'Enable' : 'Disable';
          toggleBtn.textContent = isDisabled ? '\u25CB' : '\u25CF';
          zapLi.appendChild(toggleBtn);

          const infoDiv = document.createElement('div');
          infoDiv.style.cssText = 'flex:1;min-width:0;';

          const stableSel = document.createElement('div');
          stableSel.className = 'zap-selector stable';
          stableSel.title = fp.stableSelector || entry.selector;
          stableSel.textContent = fp.stableSelector || entry.selector;
          infoDiv.appendChild(stableSel);

          if (hasDynamic) {
            const dynSel = document.createElement('div');
            dynSel.className = 'zap-selector dynamic';
            dynSel.title = 'Original selector (unstable): ' + entry.selector;
            dynSel.textContent = entry.selector;
            infoDiv.appendChild(dynSel);
          }

          zapLi.appendChild(infoDiv);

          const tagSpan = document.createElement('span');
          tagSpan.className = 'zap-tag';
          tagSpan.textContent = entry.tag;
          zapLi.appendChild(tagSpan);

          const badge = document.createElement('span');
          badge.className = 'zap-persistent-badge' + (isDisabled ? ' disabled' : '');
          badge.textContent = 'Persistent';
          zapLi.appendChild(badge);

          const timeSpan = document.createElement('span');
          timeSpan.className = 'zap-time';
          timeSpan.textContent = time;
          zapLi.appendChild(timeSpan);

          const removeBtn = document.createElement('button');
          removeBtn.className = 'btn-icon danger';
          removeBtn.dataset.action = 'remove-rule';
          removeBtn.dataset.domain = domain;
          removeBtn.dataset.id = entry.id;
          removeBtn.title = 'Remove';
          removeBtn.textContent = '\u2715';
          zapLi.appendChild(removeBtn);
        } else {
          const selSpan = document.createElement('span');
          selSpan.className = 'zap-selector';
          selSpan.title = entry.selector;
          selSpan.textContent = entry.selector;
          zapLi.appendChild(selSpan);

          const tagSpan = document.createElement('span');
          tagSpan.className = 'zap-tag';
          tagSpan.textContent = entry.tag;
          zapLi.appendChild(tagSpan);

          const timeSpan = document.createElement('span');
          timeSpan.className = 'zap-time';
          timeSpan.textContent = time;
          zapLi.appendChild(timeSpan);

          const removeBtn = document.createElement('button');
          removeBtn.className = 'btn-icon danger';
          removeBtn.dataset.action = 'remove-history';
          removeBtn.dataset.domain = domain;
          removeBtn.dataset.index = String(i);
          removeBtn.title = 'Remove';
          removeBtn.textContent = '\u2715';
          zapLi.appendChild(removeBtn);
        }

        zapListUl.appendChild(zapLi);
      });

      siteLi.appendChild(zapListUl);
      siteListEl.appendChild(siteLi);
    });
  }

  // Dashboard click events (delegated)
  siteListEl.addEventListener('click', (e) => {
    // Expand/collapse
    const header = e.target.closest('.site-header');
    if (header && !e.target.closest('[data-action]')) {
      header.closest('.site-item').classList.toggle('open');
      return;
    }

    // Toggle rule
    const toggleBtn = e.target.closest('[data-action="toggle-rule"]');
    if (toggleBtn) {
      const domain = toggleBtn.dataset.domain;
      const ruleId = toggleBtn.dataset.id;
      if (zapRules[domain]) {
        const rule = zapRules[domain].find(r => r.id === ruleId);
        if (rule) {
          rule.disabled = !rule.disabled;
          saveRules();
          renderDashboard();
          showToast(rule.disabled ? 'Rule disabled' : 'Rule enabled');
        }
      }
      return;
    }

    // Remove single rule
    const removeRuleBtn = e.target.closest('[data-action="remove-rule"]');
    if (removeRuleBtn) {
      const domain = removeRuleBtn.dataset.domain;
      const ruleId = removeRuleBtn.dataset.id;
      if (zapRules[domain]) {
        zapRules[domain] = zapRules[domain].filter(r => r.id !== ruleId);
        if (zapRules[domain].length === 0) delete zapRules[domain];
        saveRules();
        renderDashboard();
        showToast('Rule removed');
      }
      return;
    }

    // Remove single history
    const removeHistBtn = e.target.closest('[data-action="remove-history"]');
    if (removeHistBtn) {
      const domain = removeHistBtn.dataset.domain;
      const index = parseInt(removeHistBtn.dataset.index, 10);
      if (zapHistory[domain]) {
        zapHistory[domain].splice(index, 1);
        if (zapHistory[domain].length === 0) delete zapHistory[domain];
        saveHistory();
        renderDashboard();
        showToast('History entry removed');
      }
      return;
    }

    // Clear site
    const clearBtn = e.target.closest('[data-action="clear-site"]');
    if (clearBtn) {
      const domain = clearBtn.dataset.domain;
      const data = currentDashTab === 'rules' ? zapRules : zapHistory;
      const count = (data[domain] || []).length;
      showConfirm('Clear ' + domain + '?', 'Remove all ' + count + ' items for this site.').then(ok => {
        if (ok) {
          delete data[domain];
          if (currentDashTab === 'rules') saveRules(); else saveHistory();
          renderDashboard();
          showToast(domain + ' cleared');
        }
      });
      return;
    }
  });

  // Clear all
  document.getElementById('btnClearAll').addEventListener('click', () => {
    const data = currentDashTab === 'rules' ? zapRules : zapHistory;
    const total = Object.values(data).reduce((s, a) => s + a.length, 0);
    if (total === 0) return;
    showConfirm('Clear All?', 'Remove all ' + total + ' items across all sites.').then(ok => {
      if (ok) {
        if (currentDashTab === 'rules') { zapRules = {}; saveRules(); }
        else { zapHistory = {}; saveHistory(); }
        renderDashboard();
        showToast('All cleared');
      }
    });
  });

  // Export
  document.getElementById('btnExport').addEventListener('click', () => {
    const exportData = currentDashTab === 'rules' ? zapRules : zapHistory;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'zapper-' + currentDashTab + '.json'; a.click();
    URL.revokeObjectURL(url);
    showToast('Exported');
  });

  // Search
  dashSearchEl.addEventListener('input', renderDashboard);

  // ==========================================================
  // SETTINGS: Preferences & Developer
  // ==========================================================

  const themeSelect = document.getElementById('theme');
  const blacklistEl = document.getElementById('blacklist');
  const toggles = document.querySelectorAll('.toggle[data-key]');
  const fileImport = document.getElementById('fileImport');

  async function loadSettings() {
    try {
      const result = await browser.storage.local.get([
        'theme', 'showPath', 'showToast', 'animation',
        'recordHistory', 'showBadge', 'blacklist'
      ]);

      const theme = result.theme || 'auto';
      themeSelect.value = theme;
      applyTheme(theme);

      toggles.forEach(t => {
        const key = t.dataset.key;
        const val = result[key] !== false;
        t.classList.toggle('on', val);
      });

      blacklistEl.value = (result.blacklist || []).join('\n');
    } catch (e) {}
  }

  function applyTheme(theme) {
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  async function saveSetting(key, value) {
    try { await browser.storage.local.set({ [key]: value }); } catch (e) {}
  }

  // Theme
  themeSelect.addEventListener('change', () => {
    const val = themeSelect.value;
    applyTheme(val);
    saveSetting('theme', val);
    showToast('Theme: ' + (val === 'auto' ? 'system' : val));
  });

  // Toggles
  toggles.forEach(toggle => {
    toggle.addEventListener('click', () => {
      const key = toggle.dataset.key;
      const isOn = toggle.classList.toggle('on');
      saveSetting(key, isOn);
      showToast((isOn ? 'Enabled' : 'Disabled') + ': ' + key.replace(/([A-Z])/g, ' $1').toLowerCase());
    });
  });

  // Blacklist
  let blacklistTimer = null;
  blacklistEl.addEventListener('input', () => {
    clearTimeout(blacklistTimer);
    blacklistTimer = setTimeout(() => {
      const lines = blacklistEl.value.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);
      saveSetting('blacklist', lines);
    }, 500);
  });

  // Export settings
  document.getElementById('btnExportSettings').addEventListener('click', () => {
    browser.storage.local.get(null).then(data => {
      const exportData = {
        theme: data.theme || 'auto',
        showPath: data.showPath !== false,
        showToast: data.showToast !== false,
        animation: data.animation !== false,
        recordHistory: data.recordHistory !== false,
        showBadge: data.showBadge !== false,
        blacklist: data.blacklist || []
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'zapper-settings.json'; a.click();
      URL.revokeObjectURL(url);
      showToast('Settings exported');
    });
  });

  // Import settings
  document.getElementById('btnImportSettings').addEventListener('click', () => {
    fileImport.click();
  });

  fileImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.theme) { themeSelect.value = data.theme; applyTheme(data.theme); saveSetting('theme', data.theme); }
        ['showPath', 'showToast', 'animation', 'recordHistory', 'showBadge'].forEach(key => {
          if (typeof data[key] === 'boolean') {
            document.querySelector('[data-key="' + key + '"]').classList.toggle('on', data[key]);
            saveSetting(key, data[key]);
          }
        });
        if (Array.isArray(data.blacklist)) {
          blacklistEl.value = data.blacklist.join('\n');
          saveSetting('blacklist', data.blacklist);
        }
        showToast('Settings imported');
      } catch (err) {
        showToast('Invalid settings file');
      }
    };
    reader.readAsText(file);
    fileImport.value = '';
  });

  // Reset all
  document.getElementById('btnResetAll').addEventListener('click', async () => {
    if (!confirm('Reset all Content Zapper settings and zap history?')) return;
    try {
      await browser.storage.local.clear();
      loadSettings();
      loadDashboardData();
      showToast('All data reset');
    } catch (e) {
      showToast('Reset failed');
    }
  });

  // ==========================================================
  // DEVELOPER ADDONS
  // ==========================================================

  const addonListEl = document.getElementById('addonList');
  const addonSummaryEl = document.getElementById('addonSummary');
  const lastRefreshedEl = document.getElementById('lastRefreshed');
  const btnRefreshAddons = document.getElementById('btnRefreshAddons');
  const AMO_API_BASE = 'https://addons.mozilla.org/api/v5/addons/addon/';

  const ADDON_SLUGS = [
    'protonvpn-launcher', 'protonpass-launcher', 'protonmail-launcher',
    'tabby-time-tracker', 'oled-chatgpt-theme', 'smoothcorners',
    'web-troller', 'roundify', 'amoler'
  ];

  let addonData = [];

  function formatNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function renderAddons(addons) {
    if (!addons.length) {
      addonListEl.textContent = '';
      const emptyLi = document.createElement('li');
      emptyLi.style.cssText = 'padding:20px;text-align:center;color:var(--text-muted);font-size:12px;';
      emptyLi.textContent = 'No extensions found.';
      addonListEl.appendChild(emptyLi);
      addonSummaryEl.textContent = '';
      return;
    }

    addons.sort((a, b) => b.users - a.users);
    addonData = addons;

    // Build addon cards with DOM API
    addonListEl.textContent = '';

    addons.forEach(addon => {
      const ratingText = addon.reviews > 0
        ? addon.rating.toFixed(1) + '/5 (' + addon.reviews + ')'
        : 'No ratings';

      const li = document.createElement('li');
      li.className = 'addon-card';
      li.dataset.slug = addon.slug;

      const iconImg = document.createElement('img');
      iconImg.className = 'addon-icon';
      iconImg.src = addon.icon;
      iconImg.alt = '';
      iconImg.loading = 'lazy';
      li.appendChild(iconImg);

      const infoDiv = document.createElement('div');
      infoDiv.className = 'addon-info';
      const nameDiv = document.createElement('div');
      nameDiv.className = 'addon-name';
      nameDiv.textContent = addon.name;
      infoDiv.appendChild(nameDiv);
      const summaryDiv = document.createElement('div');
      summaryDiv.className = 'addon-summary';
      summaryDiv.textContent = addon.summary;
      infoDiv.appendChild(summaryDiv);
      li.appendChild(infoDiv);

      const statsDiv = document.createElement('div');
      statsDiv.className = 'addon-stats';
      const usersSpan = document.createElement('span');
      usersSpan.className = 'addon-users';
      usersSpan.textContent = formatNum(addon.users) + ' users';
      statsDiv.appendChild(usersSpan);

      const ratingSpan = document.createElement('span');
      ratingSpan.className = 'addon-rating';
      if (addon.rating) {
        const starsSpan = document.createElement('span');
        starsSpan.className = 'addon-stars';
        let stars = '';
        for (let i = 1; i <= 5; i++) {
          stars += i <= Math.round(addon.rating) ? '\u2605' : '\u2606';
        }
        starsSpan.textContent = stars;
        ratingSpan.appendChild(starsSpan);
        ratingSpan.appendChild(document.createTextNode(' ' + ratingText));
      } else {
        ratingSpan.textContent = 'No ratings';
      }
      statsDiv.appendChild(ratingSpan);
      li.appendChild(statsDiv);

      li.style.cursor = 'pointer';
      li.addEventListener('click', () => {
        window.open('https://addons.mozilla.org/en-GB/firefox/addon/' + addon.slug + '/', '_blank');
      });

      addonListEl.appendChild(li);
    });

    // Summary bar
    addonSummaryEl.textContent = '';
    const totalUsers = addons.reduce((s, a) => s + a.users, 0);
    const totalReviews = addons.reduce((s, a) => s + a.reviews, 0);
    const ratedCount = addons.filter(a => a.reviews > 0).length;

    [
      { label: String(addons.length), suffix: ' extensions' },
      { label: formatNum(totalUsers), suffix: ' total users' },
      { label: String(totalReviews), suffix: ' reviews across ' + ratedCount + ' rated' }
    ].forEach(item => {
      const span = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = item.label;
      span.appendChild(strong);
      span.appendChild(document.createTextNode(item.suffix));
      addonSummaryEl.appendChild(span);
    });
  }

  async function loadBundledAddons() {
    try {
      const resp = await fetch(browser.runtime.getURL('settings/developer-addons.json'));
      const data = await resp.json();
      renderAddons(data);
      // Check for cached API data
      try {
        const cached = await browser.storage.local.get(['addonStatsCached', 'addonStatsTime']);
        if (cached.addonStatsCached && cached.addonStatsTime) {
          const age = Date.now() - cached.addonStatsTime;
          if (age < 6 * 60 * 60 * 1000) {
            renderAddons(cached.addonStatsCached);
            lastRefreshedEl.textContent = 'Updated ' + new Date(cached.addonStatsTime).toLocaleString();
          }
        }
      } catch (e) {}
    } catch (e) {
      addonListEl.textContent = '';
      const errLi = document.createElement('li');
      errLi.style.cssText = 'padding:20px;text-align:center;color:var(--text-muted);font-size:12px;';
      errLi.textContent = 'Failed to load extension data.';
      addonListEl.appendChild(errLi);
    }
  }

  async function refreshFromAPI() {
    btnRefreshAddons.classList.add('loading');
    btnRefreshAddons.textContent = 'Refreshing...';

    try {
      const results = await Promise.allSettled(
        ADDON_SLUGS.map(async slug => {
          const resp = await fetch(AMO_API_BASE + slug + '/');
          if (!resp.ok) throw new Error(resp.status);
          const addon = await resp.json();
          return {
            slug: slug,
            name: addon.name && addon.name['en-GB'] ? addon.name['en-GB'] : (addon.name && addon.name['en-US'] ? addon.name['en-US'] : slug),
            summary: addon.summary && addon.summary['en-GB'] ? addon.summary['en-GB'] : (addon.summary && addon.summary['en-US'] ? addon.summary['en-US'] : ''),
            rating: addon.ratings && addon.ratings.average ? addon.ratings.average : 0,
            reviews: addon.ratings && addon.ratings.count ? addon.ratings.count : 0,
            users: addon.average_daily_users || 0,
            icon: addon.icon_url || '',
            url: 'https://addons.mozilla.org/en-GB/firefox/addon/' + slug + '/'
          };
        })
      );

      const addons = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);

      if (addons.length > 0) {
        renderAddons(addons);
        try {
          await browser.storage.local.set({
            addonStatsCached: addons,
            addonStatsTime: Date.now()
          });
        } catch (e) {}
        lastRefreshedEl.textContent = 'Updated just now';
        showToast('Stats refreshed (' + addons.length + ' extensions)');
      } else {
        showToast('Failed to fetch stats');
      }
    } catch (e) {
      showToast('Refresh failed: ' + e.message);
    }

    btnRefreshAddons.classList.remove('loading');
    btnRefreshAddons.textContent = '\u21BB Refresh stats';
  }

  btnRefreshAddons.addEventListener('click', refreshFromAPI);

  // ==========================================================
  // INIT
  // ==========================================================

  async function init() {
    // Load theme first
    try {
      const prefs = await browser.storage.local.get(['theme']);
      if (prefs.theme) document.documentElement.setAttribute('data-theme', prefs.theme);
    } catch (e) {}

    // Determine initial tab from hash
    initTabFromHash();

    // Listen for hash changes
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace('#', '');
      if (hash === 'settings') switchMainTab('settings');
      else switchMainTab('dashboard');
    });

    // Load data in parallel
    loadSettings();
    loadDashboardData();
    loadBundledAddons();
  }

  init();
})();
