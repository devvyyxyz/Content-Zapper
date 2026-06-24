/* ============================================================
   Content Zapper - Settings Script
   ============================================================ */

(function Settings() {
  'use strict';

  const toastEl = document.getElementById('toast');
  const themeSelect = document.getElementById('theme');
  const blacklistEl = document.getElementById('blacklist');
  const toggles = document.querySelectorAll('.toggle[data-key]');
  const fileImport = document.getElementById('fileImport');

  // ---- Helpers ----
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ---- Toast ----
  function showToast(msg, ms = 2000) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  // ---- Load ----
  async function loadSettings() {
    try {
      const result = await browser.storage.local.get([
        'theme', 'showPath', 'showToast', 'animation',
        'recordHistory', 'showBadge', 'blacklist'
      ]);

      // Theme
      const theme = result.theme || 'auto';
      themeSelect.value = theme;
      applyTheme(theme);

      // Toggles
      toggles.forEach(t => {
        const key = t.dataset.key;
        const val = result[key] !== false; // default true
        t.classList.toggle('on', val);
      });

      // Blacklist
      blacklistEl.value = (result.blacklist || []).join('\n');
    } catch (e) {}
  }

  // ---- Theme ----
  function applyTheme(theme) {
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  // ---- Save settings helper ----
  async function saveSetting(key, value) {
    try {
      await browser.storage.local.set({ [key]: value });
    } catch (e) {}
  }

  // ---- Events ----

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

  // Blacklist (save on blur with debounce)
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
      // Remove internal counters, keep settings only
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
        if (typeof data.showPath === 'boolean') {
          document.querySelector('[data-key="showPath"]').classList.toggle('on', data.showPath);
          saveSetting('showPath', data.showPath);
        }
        if (typeof data.showToast === 'boolean') {
          document.querySelector('[data-key="showToast"]').classList.toggle('on', data.showToast);
          saveSetting('showToast', data.showToast);
        }
        if (typeof data.animation === 'boolean') {
          document.querySelector('[data-key="animation"]').classList.toggle('on', data.animation);
          saveSetting('animation', data.animation);
        }
        if (typeof data.recordHistory === 'boolean') {
          document.querySelector('[data-key="recordHistory"]').classList.toggle('on', data.recordHistory);
          saveSetting('recordHistory', data.recordHistory);
        }
        if (typeof data.showBadge === 'boolean') {
          document.querySelector('[data-key="showBadge"]').classList.toggle('on', data.showBadge);
          saveSetting('showBadge', data.showBadge);
        }
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
      showToast('All data reset');
    } catch (e) {
      showToast('Reset failed');
    }
  });

  // Back
  document.getElementById('btnBack').addEventListener('click', () => window.close());

  // ---- Developer Addons ----

  const addonListEl = document.getElementById('addonList');
  const addonSummaryEl = document.getElementById('addonSummary');
  const lastRefreshedEl = document.getElementById('lastRefreshed');
  const btnRefreshAddons = document.getElementById('btnRefreshAddons');
  const AMO_PROFILE = 'https://addons.mozilla.org/en-GB/firefox/user/18887466/';
  const AMO_API_BASE = 'https://addons.mozilla.org/api/v5/addons/addon/';

  // Slugs for all devvyyxyz addons
  const ADDON_SLUGS = [
    'protonvpn-launcher', 'protonpass-launcher', 'protonmail-launcher',
    'tabby-time-tracker', 'oled-chatgpt-theme', 'smoothcorners',
    'web-troller', 'roundify', 'amoler'
  ];

  let addonData = [];

  function starsHtml(rating) {
    if (!rating) return '<span class="addon-stars">No ratings</span>';
    let stars = '';
    for (let i = 1; i <= 5; i++) {
      stars += i <= Math.round(rating) ? '\u2605' : '\u2606';
    }
    return '<span class="addon-stars">' + stars + '</span>';
  }

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

    // Sort by users descending
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

      // Make card clickable
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => {
        window.open('https://addons.mozilla.org/en-GB/firefox/addon/' + addon.slug + '/', '_blank');
      });

      addonListEl.appendChild(li);
    });

    // Summary bar using DOM API
    addonSummaryEl.textContent = '';
    const totalUsers = addons.reduce((s, a) => s + a.users, 0);
    const totalReviews = addons.reduce((s, a) => s + a.reviews, 0);
    const ratedCount = addons.filter(a => a.reviews > 0).length;

    const s1 = document.createElement('span');
    const s1b = document.createElement('strong');
    s1b.textContent = String(addons.length);
    s1.appendChild(s1b);
    s1.appendChild(document.createTextNode(' extensions'));
    addonSummaryEl.appendChild(s1);

    const s2 = document.createElement('span');
    const s2b = document.createElement('strong');
    s2b.textContent = formatNum(totalUsers);
    s2.appendChild(s2b);
    s2.appendChild(document.createTextNode(' total users'));
    addonSummaryEl.appendChild(s2);

    const s3 = document.createElement('span');
    const s3b = document.createElement('strong');
    s3b.textContent = String(totalReviews);
    s3.appendChild(s3b);
    s3.appendChild(document.createTextNode(' reviews across ' + ratedCount + ' rated'));
    addonSummaryEl.appendChild(s3);
  }

  // Load bundled data (fast, offline-capable)
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
          // If cached data is less than 6 hours old, use it
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

  // Refresh from AMO API
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
        // Cache the results
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

  // ---- Init ----
  loadSettings();
  loadBundledAddons();
})();
