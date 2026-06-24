/* ============================================================
   Content Zapper - Popup Script (Simplified)
   ============================================================ */

(function PopupController() {
  'use strict';

  const badge = document.getElementById('badge');
  const btnToggle = document.getElementById('btnToggle');
  const btnUndo = document.getElementById('btnUndo');
  const btnRefresh = document.getElementById('btnRefresh');
  const navDashboard = document.getElementById('navDashboard');
  const navSettings = document.getElementById('navSettings');

  let isActive = false;

  // ---- Helpers ----
  async function sendToTab(message) {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab) return await browser.tabs.sendMessage(tab.id, message);
    } catch (e) {}
    return null;
  }

  // ---- Init ----
  async function init() {
    // Load theme
    try {
      const prefs = await browser.storage.local.get(['theme']);
      if (prefs.theme) {
        document.documentElement.setAttribute('data-theme', prefs.theme);
      }
    } catch (e) {}

    // Get tab status
    const response = await sendToTab({ type: 'getStatus' });
    if (response) {
      isActive = response.active;
      render();
    }
  }

  function render() {
    if (isActive) {
      badge.textContent = 'ON';
      badge.classList.add('active');
      btnToggle.textContent = 'Deactivate Zapper';
      btnToggle.classList.add('active');
    } else {
      badge.textContent = 'OFF';
      badge.classList.remove('active');
      btnToggle.textContent = 'Activate Zapper';
      btnToggle.classList.remove('active');
    }
    btnUndo.disabled = true; // We don't track undo count in popup
  }

  // ---- Events ----
  btnToggle.addEventListener('click', async () => {
    const res = await sendToTab({ type: 'toggle' });
    if (res) { isActive = res.active; render(); }
  });

  btnUndo.addEventListener('click', async () => {
    await sendToTab({ type: 'undo' });
  });

  btnRefresh.addEventListener('click', () => {
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab) browser.tabs.reload(tab.id);
    });
    window.close();
  });

  navDashboard.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('dashboard/dashboard.html#dashboard') });
    window.close();
  });

  navSettings.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('dashboard/dashboard.html#settings') });
    window.close();
  });

  init();
})();
