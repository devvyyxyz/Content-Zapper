/* ============================================================
   Content Zapper - Background Service Worker (v1.2)
   Manages state, badges, context menus, stats, zap history,
   zap rules with fingerprints, and blacklist.
   ========================================================== */

(function BackgroundController() {
  'use strict';

  let sessionZapCount = 0;
  let totalZapCount = 0;

  async function init() {
    try {
      const result = await browser.storage.local.get(['sessionZapCount', 'totalZapCount']);
      sessionZapCount = result.sessionZapCount || 0;
      totalZapCount = result.totalZapCount || 0;
    } catch (e) {
      sessionZapCount = 0;
      totalZapCount = 0;
    }
    createContextMenus();
  }

  /* ---- Context Menus ---- */
  function createContextMenus() {
    try {
      browser.contextMenus.create({
        id: 'toggle-zapper',
        title: 'Zapper: Toggle Zapper mode',
        contexts: ['page']
      });
    } catch (e) {}
  }

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab || !tab.id) return;
    if (info.menuItemId === 'toggle-zapper') {
      await browser.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {});
    }
  });

  /* ---- Zap history ---- */
  async function addZapToHistory(domain, selector, tag) {
    try {
      const result = await browser.storage.local.get(['zapHistory', 'recordHistory']);
      if (result.recordHistory === false) return;
      const history = result.zapHistory || {};
      if (!history[domain]) history[domain] = [];
      if (!history[domain].some(z => z.selector === selector)) {
        history[domain].push({
          selector: selector,
          tag: tag,
          timestamp: Date.now()
        });
      }
      await browser.storage.local.set({ zapHistory: history });
    } catch (e) {}
  }

  /* ---- Zap rules (persistent zaps with fingerprints) ---- */
  async function addZapRule(domain, fingerprint, selector, tag) {
    try {
      const result = await browser.storage.local.get(['zapRules']);
      const rules = result.zapRules || {};
      if (!rules[domain]) rules[domain] = [];

      // Avoid duplicates by stable selector or exact selector
      const stableSelector = fingerprint.stableSelector || selector;
      const exists = rules[domain].some(r =>
        r.selector === selector || r.fingerprint.stableSelector === stableSelector
      );
      if (exists) return;

      rules[domain].push({
        id: 'zr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        selector: selector,
        tag: tag,
        fingerprint: fingerprint,
        disabled: false,
        createdAt: Date.now()
      });

      await browser.storage.local.set({ zapRules: rules });
    } catch (e) {}
  }

  /* ---- Message handling ---- */
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    switch (message.type) {

      case 'zap': {
        const domain = message.domain || getDomain(sender);
        sessionZapCount++;
        totalZapCount++;

        browser.storage.local.set({ sessionZapCount, totalZapCount });

        // Record history
        addZapToHistory(domain, message.selector, message.tag);

        // Store zap rule with fingerprint for persistence
        if (message.fingerprint) {
          addZapRule(domain, message.fingerprint, message.selector, message.tag);
        }

        // Badge
        if (sender.tab && sender.tab.id) {
          try {
            browser.storage.local.get(['showBadge']).then(r => {
              if (r.showBadge === false) return;
              browser.action.setBadgeText({ text: String(sessionZapCount), tabId: sender.tab.id });
              browser.action.setBadgeBackgroundColor({ color: '#cc2222', tabId: sender.tab.id });
            });
          } catch (e) {}
        }

        broadcastStats();
        sendResponse({ ok: true });
        break;
      }

      case 'undo':
        if (sessionZapCount > 0) sessionZapCount--;
        browser.storage.local.set({ sessionZapCount });
        broadcastStats();
        sendResponse({ ok: true });
        break;

      case 'activated':
        if (sender.tab && sender.tab.id) {
          browser.action.setBadgeText({ text: 'ON', tabId: sender.tab.id });
          browser.action.setBadgeBackgroundColor({ color: '#cc2222', tabId: sender.tab.id });
        }
        sendResponse({ ok: true });
        break;

      case 'deactivated':
        if (sender.tab && sender.tab.id) {
          browser.action.setBadgeText({ text: '', tabId: sender.tab.id });
        }
        sendResponse({ ok: true });
        break;

      case 'getBlacklist': {
        browser.storage.local.get(['blacklist']).then(result => {
          sendResponse({ blacklist: result.blacklist || [] });
        });
        return true;
      }

      case 'getZapRules': {
        const domain = message.domain;
        browser.storage.local.get(['zapRules']).then(result => {
          const rules = result.zapRules || {};
          sendResponse({ rules: rules[domain] || [] });
        });
        return true;
      }

      case 'getAllZapRules': {
        browser.storage.local.get(['zapRules']).then(result => {
          sendResponse({ zapRules: result.zapRules || {} });
        });
        return true;
      }

      case 'removeZapRule': {
        const { domain, ruleId } = message;
        browser.storage.local.get(['zapRules']).then(result => {
          const rules = result.zapRules || {};
          if (rules[domain]) {
            rules[domain] = rules[domain].filter(r => r.id !== ruleId);
            if (rules[domain].length === 0) delete rules[domain];
          }
          browser.storage.local.set({ zapRules: rules });
          sendResponse({ ok: true });
        });
        return true;
      }

      case 'toggleZapRule': {
        const { domain, ruleId, disabled } = message;
        browser.storage.local.get(['zapRules']).then(result => {
          const rules = result.zapRules || {};
          if (rules[domain]) {
            const rule = rules[domain].find(r => r.id === ruleId);
            if (rule) rule.disabled = disabled;
          }
          browser.storage.local.set({ zapRules: rules });
          sendResponse({ ok: true });
        });
        return true;
      }

      case 'clearDomainRules': {
        const domain = message.domain;
        browser.storage.local.get(['zapRules']).then(result => {
          const rules = result.zapRules || {};
          delete rules[domain];
          browser.storage.local.set({ zapRules: rules });
          sendResponse({ ok: true });
        });
        return true;
      }

      default:
        sendResponse({ error: 'Unknown message type' });
    }

    return true;
  });

  /* ---- Helpers ---- */
  function getDomain(sender) {
    try {
      if (sender.tab && sender.tab.url) return new URL(sender.tab.url).hostname;
    } catch (e) {}
    return 'unknown';
  }

  function broadcastStats() {
    browser.runtime.sendMessage({
      type: 'statsUpdate',
      zapped: sessionZapCount,
      session: sessionZapCount,
      total: totalZapCount
    }).catch(() => {});
  }

  /* ---- Keyboard shortcuts ---- */
  browser.commands.onCommand.addListener(async (command) => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      const msg = command === 'toggle-zapper' ? 'toggle' : command === 'undo-last-zap' ? 'undo' : null;
      if (msg) await browser.tabs.sendMessage(tab.id, { type: msg });
    } catch (e) {}
  });

  /* ---- Tab lifecycle ---- */
  browser.tabs.onActivated.addListener((info) => {
    browser.action.setBadgeText({ text: '', tabId: info.tabId }).catch(() => {});
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    browser.action.setBadgeText({ text: '', tabId: tabId }).catch(() => {});
  });

  /* ---- Auto-apply on tab load ---- */
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
      browser.tabs.sendMessage(tabId, { type: 'applyBlacklist' }).catch(() => {});
      browser.tabs.sendMessage(tabId, { type: 'applyPersistentZaps' }).catch(() => {});
    }
  });

  init();
})();
