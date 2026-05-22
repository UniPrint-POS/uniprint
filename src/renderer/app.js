(function () {
  'use strict';

  // ── Utilities ────────────────────────────────────────────

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);

  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 320);
    }, 4000);
  }

  // ── Tab routing ──────────────────────────────────────────

  let currentTab = 'dashboard';
  let statusPollInterval = null;
  let logAutoscroll = true;

  const tabs = ['dashboard', 'printers', 'whitelist', 'apikey', 'logs', 'updates'];

  function showTab(tabId) {
    currentTab = tabId;
    tabs.forEach(id => {
      const section = document.getElementById(`tab-${id}`);
      const btn     = document.querySelector(`[data-tab="${id}"]`);
      if (section) section.classList.toggle('hidden', id !== tabId);
      if (btn)     btn.classList.toggle('active', id === tabId);
    });
    if (tabId === 'printers')  loadPrinters();
    if (tabId === 'logs')      loadLogs();
    if (tabId === 'updates')   loadVersion();
    if (tabId === 'whitelist') renderWhitelistPage();
    if (tabId === 'apikey')    renderApiKeyPage();
  }

  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  // ── Status badge ─────────────────────────────────────────

  function updateStatusBadge(connected) {
    const badge = document.getElementById('header-status');
    badge.textContent = connected ? 'Online' : 'Offline';
    badge.className   = `status-badge ${connected ? 'online' : 'offline'}`;
  }

  async function refreshStatus() {
    try {
      const status    = await window.uniprint.getStatus();
      const connected = status && status.connected;
      updateStatusBadge(connected);

      const printerEl = document.getElementById('stat-printer');
      if (printerEl) {
        printerEl.textContent = connected ? 'Connected' : 'Offline';
        printerEl.className   = `stat-value ${connected ? 'green' : 'red'}`;
      }

      const queueEl = document.getElementById('stat-queue');
      if (queueEl) queueEl.textContent = status ? String(status.queue || 0) : '0';
    } catch {}
  }

  async function loadPort() {
    try {
      const port = await window.uniprint.getServerPort();
      const el   = document.getElementById('port-info');
      if (el && port) el.textContent = `Port ${port}`;
    } catch {}
  }

  // ── Dashboard buttons ────────────────────────────────────

  document.getElementById('btn-test-print').addEventListener('click', async () => {
    try {
      await window.uniprint.testPrint();
      toast('Test print sent to queue', 'success');
    } catch (err) {
      toast(`Test print failed: ${err.message}`, 'error');
    }
  });

  document.getElementById('btn-reconnect').addEventListener('click', async () => {
    try {
      await window.uniprint.connectPrinter();
      toast('Reconnect attempted', 'info');
      await refreshStatus();
    } catch (err) {
      toast(`Reconnect failed: ${err.message}`, 'error');
    }
  });

  // ── Printers ─────────────────────────────────────────────

  let allPrinters = [];
  let selectedPrinterConfig = null;

  async function loadPrinters() {
    const listEl = document.getElementById('printer-list');
    listEl.innerHTML = '<div class="empty-state">Scanning for printers...</div>';
    try {
      allPrinters = await window.uniprint.listPrinters();
      renderPrinters();
    } catch {
      listEl.innerHTML = '<div class="empty-state">Failed to scan printers.</div>';
    }
  }

  async function loadSelectedPrinterInfo() {
    try {
      const cfg = await window.uniprint.getConfig();
      selectedPrinterConfig = cfg.selectedPrinter;
      renderSelectedPrinterInfo();
    } catch {}
  }

  function renderSelectedPrinterInfo() {
    const box    = document.getElementById('selected-printer-info');
    const nameEl = document.getElementById('selected-printer-name');
    if (selectedPrinterConfig && selectedPrinterConfig.name) {
      nameEl.textContent = selectedPrinterConfig.name;
      box.classList.remove('hidden');
    } else {
      box.classList.add('hidden');
    }
  }

  function renderPrinters() {
    const listEl = document.getElementById('printer-list');
    if (!allPrinters || allPrinters.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No printers detected. Make sure your printer is connected.</div>';
      return;
    }
    listEl.innerHTML = allPrinters.map((p, i) => {
      const isSelected  = selectedPrinterConfig && selectedPrinterConfig.name === p.name && selectedPrinterConfig.type === p.type;
      const badgeClass  = p.type === 'usb' ? 'badge-usb' : 'badge-windows';
      const badgeLabel  = p.type === 'usb' ? 'USB' : 'Windows';
      return `<div class="printer-item ${isSelected ? 'selected' : ''}">
        <div class="printer-info">
          <span class="badge ${escHtml(badgeClass)}">${escHtml(badgeLabel)}</span>
          <span class="printer-name">${escHtml(p.name)}</span>
          ${p.portName ? `<span class="printer-port">${escHtml(p.portName)}</span>` : ''}
        </div>
        <button class="btn btn-primary" data-printer-idx="${i}" ${isSelected ? 'disabled' : ''}>${isSelected ? 'Selected' : 'Select'}</button>
      </div>`;
    }).join('');

    listEl.querySelectorAll('[data-printer-idx]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const printer = allPrinters[parseInt(btn.dataset.printerIdx, 10)];
        try {
          await window.uniprint.selectPrinter(printer);
          selectedPrinterConfig = printer;
          renderPrinters();
          renderSelectedPrinterInfo();
          toast(`Selected: ${printer.name}`, 'success');
          await refreshStatus();
        } catch (err) {
          toast(`Failed to select printer: ${err.message}`, 'error');
        }
      });
    });
  }

  document.getElementById('btn-refresh-printers').addEventListener('click', loadPrinters);

  // ════════════════════════════════════════════════════════
  //  ACCOUNT PIN — shared modal logic
  // ════════════════════════════════════════════════════════

  let _pinCallback   = null; // (pin: string) => void
  let _sessionPin    = null; // verified PIN cached for this session

  const ALL_MODALS = [
    'modal-account-pin-setup',
    'modal-account-pin-confirm',
    'modal-key-display',
    'modal-clear-apikey-confirm',
    'modal-clear-whitelist-confirm',
  ];

  function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  }

  ALL_MODALS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', e => { if (e.target === el) { closeModal(id); _pinCallback = null; } });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ALL_MODALS.forEach(closeModal);
      _pinCallback = null;
    }
  });

  // withAccountPin(pageName, onVerified)
  //   - pageName: 'API Key' | 'Whitelist' (we'll use it in messaging)
  //   - onVerified: async (pin) => {}  called after PIN is verified/set
  async function withAccountPin(pageName, onVerified) {
    const cfg    = await window.uniprint.getConfig();
    _pinCallback = onVerified;

    if (!cfg.hasAccountPin) {
      // First-time PIN setup
      document.getElementById('pin-setup-input').value   = '';
      document.getElementById('pin-setup-confirm').value = '';
      const errEl = document.getElementById('pin-setup-error');
      errEl.textContent = '';
      errEl.classList.add('hidden');
      openModal('modal-account-pin-setup');
      setTimeout(() => document.getElementById('pin-setup-input').focus(), 50);
    } else {
      // Confirm existing PIN
      document.getElementById('pin-confirm-input').value = '';
      const errEl = document.getElementById('pin-confirm-error');
      errEl.textContent = '';
      errEl.classList.add('hidden');
      openModal('modal-account-pin-confirm');
      setTimeout(() => document.getElementById('pin-confirm-input').focus(), 50);
    }
  }

  // ── PIN Setup modal handlers ─────────────────────────────

  document.getElementById('btn-pin-setup-cancel').addEventListener('click', () => {
    _pinCallback = null;
    closeModal('modal-account-pin-setup');
  });

  document.getElementById('btn-pin-setup-save').addEventListener('click', async () => {
    const pin     = document.getElementById('pin-setup-input').value;
    const confirm = document.getElementById('pin-setup-confirm').value;
    const errEl   = document.getElementById('pin-setup-error');

    errEl.classList.add('hidden');

    if (pin.length < 4) {
      errEl.textContent = 'PIN must be at least 4 characters.';
      errEl.classList.remove('hidden');
      return;
    }
    if (pin !== confirm) {
      errEl.textContent = 'PINs do not match.';
      errEl.classList.remove('hidden');
      return;
    }

    try {
      const cfg = await window.uniprint.getConfig();
      if (!cfg.hasAccountPin) {
        await window.uniprint.setupAccountPin(pin, currentPageForPin);
      }
      closeModal('modal-account-pin-setup');
      _sessionPin = pin;
      if (_pinCallback) {
        const cb   = _pinCallback;
        _pinCallback = null;
        await cb(pin);
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('pin-setup-confirm').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-pin-setup-save').click();
  });

  // ── PIN Confirm modal handlers ───────────────────────────

  document.getElementById('btn-pin-confirm-cancel').addEventListener('click', () => {
    _pinCallback = null;
    closeModal('modal-account-pin-confirm');
  });

  document.getElementById('btn-pin-confirm-submit').addEventListener('click', async () => {
    const pin   = document.getElementById('pin-confirm-input').value;
    const errEl = document.getElementById('pin-confirm-error');

    errEl.classList.add('hidden');

    if (!pin) {
      errEl.textContent = 'Please enter your PIN.';
      errEl.classList.remove('hidden');
      return;
    }

    try {
      const correct = await window.uniprint.verifyAccountPin(pin);
      if (!correct) {
        const cfg = await window.uniprint.getConfig();
        errEl.textContent = `Incorrect PIN. Please use the account PIN that you set up in the ${cfg.accountPinSetPage} page.`;
        errEl.classList.remove('hidden');
        return;
      }
      closeModal('modal-account-pin-confirm');
      _sessionPin = pin;
      if (_pinCallback) {
        const cb   = _pinCallback;
        _pinCallback = null;
        await cb(pin);
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('pin-confirm-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-pin-confirm-submit').click();
  });

  // ════════════════════════════════════════════════════════
  //  WHITELIST
  // ════════════════════════════════════════════════════════

  let _whitelist = [];
  let currentPageForPin = 'Whitelist';

  async function renderWhitelistPage() {
    currentPageForPin = 'Whitelist';
    const cfg = await window.uniprint.getConfig();

    const banner = document.getElementById('whitelist-pin-banner');
    if (cfg.hasAccountPin && cfg.accountPinSetPage !== 'Whitelist') {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }

    // Show locked state; we do NOT auto-unlock
    showWhitelistLocked();
  }

  function showWhitelistLocked() {
    document.getElementById('whitelist-locked').classList.remove('hidden');
    document.getElementById('whitelist-unlocked').classList.add('hidden');
  }

  function showWhitelistUnlocked() {
    document.getElementById('whitelist-locked').classList.add('hidden');
    document.getElementById('whitelist-unlocked').classList.remove('hidden');
    renderWhitelistItems();
  }

  const _svgEdit = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

  function normalizeDomainInput(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return 'https://' + trimmed;
  }

  function renderWhitelistItems() {
    const listEl = document.getElementById('whitelist-list');
    if (!_whitelist.length) {
      listEl.innerHTML = '<div class="empty-state">No domains whitelisted. Add your first domain above.</div>';
      return;
    }
    listEl.innerHTML = _whitelist.map(origin => `
      <div class="whitelist-item">
        <span class="whitelist-origin">${escHtml(origin)}</span>
        <div class="whitelist-item-actions">
          <button class="whitelist-edit-btn" data-origin="${escHtml(origin)}" title="Edit">${_svgEdit}</button>
          <button class="whitelist-remove" data-origin="${escHtml(origin)}" title="Remove">&times;</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.whitelist-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => enterEditMode(btn.closest('.whitelist-item'), btn.dataset.origin));
    });

    listEl.querySelectorAll('.whitelist-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          _whitelist = await window.uniprint.removeFromWhitelist(btn.dataset.origin, _sessionPin);
          renderWhitelistItems();
        } catch (err) {
          toast(`Remove failed: ${err.message}`, 'error');
        }
      });
    });
  }

  function enterEditMode(itemEl, origin) {
    itemEl.innerHTML = `
      <input class="field-input whitelist-edit-input" type="text" value="${escHtml(origin)}" spellcheck="false" autocomplete="off" />
      <div class="whitelist-item-actions">
        <button class="btn btn-primary btn-xs whitelist-save-edit">Save</button>
        <button class="btn btn-ghost btn-xs whitelist-cancel-edit">Cancel</button>
      </div>
    `;
    const input = itemEl.querySelector('.whitelist-edit-input');
    input.focus();
    input.select();

    const doSave = () => saveEdit(origin, input.value, itemEl);
    itemEl.querySelector('.whitelist-save-edit').addEventListener('click', doSave);
    itemEl.querySelector('.whitelist-cancel-edit').addEventListener('click', renderWhitelistItems);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') doSave();
      if (e.key === 'Escape') renderWhitelistItems();
    });
  }

  async function saveEdit(oldOrigin, rawValue, itemEl) {
    const newOrigin = normalizeDomainInput(rawValue);
    if (!newOrigin) { toast('Domain cannot be empty.', 'error'); return; }

    try { new URL(newOrigin); } catch {
      toast('Invalid domain format.', 'error');
      return;
    }

    if (newOrigin === oldOrigin) { renderWhitelistItems(); return; }

    try {
      _whitelist = await window.uniprint.updateWhitelist(oldOrigin, newOrigin, _sessionPin);
      renderWhitelistItems();
      toast('Domain updated', 'success');
    } catch (err) {
      toast(`Update failed: ${err.message}`, 'error');
      renderWhitelistItems();
    }
  }

  document.getElementById('btn-unlock-whitelist').addEventListener('click', () => {
    currentPageForPin = 'Whitelist';
    withAccountPin('Whitelist', async (pin) => {
      const list = await window.uniprint.viewWhitelist(pin);
      if (list === null) {
        toast('Incorrect PIN.', 'error');
        return;
      }
      _whitelist = list;
      showWhitelistUnlocked();
    });
  });

  document.getElementById('btn-lock-whitelist').addEventListener('click', () => {
    _whitelist = [];
    _sessionPin = null;
    showWhitelistLocked();
  });

  document.getElementById('btn-add-whitelist').addEventListener('click', async () => {
    const input = document.getElementById('whitelist-input');
    const value = normalizeDomainInput(input.value);
    if (!value) return;

    try { new URL(value); } catch {
      toast('Invalid domain. Example: yourapp.com or https://yourapp.com', 'error');
      return;
    }

    if (!_sessionPin) {
      toast('Session expired. Lock and unlock the whitelist again.', 'error');
      return;
    }

    try {
      _whitelist = await window.uniprint.addToWhitelist(value, _sessionPin);
      input.value = '';
      renderWhitelistItems();
      toast('Origin added to whitelist', 'success');
    } catch (err) {
      toast(`Failed to add: ${err.message}`, 'error');
    }
  });

  document.getElementById('whitelist-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-add-whitelist').click();
  });

  // Clear all whitelist (no PIN required)
  document.getElementById('btn-clear-all-whitelist').addEventListener('click', () => {
    openModal('modal-clear-whitelist-confirm');
  });

  document.getElementById('btn-clear-whitelist-cancel').addEventListener('click', () => {
    closeModal('modal-clear-whitelist-confirm');
  });

  document.getElementById('btn-clear-whitelist-ok').addEventListener('click', async () => {
    try {
      await window.uniprint.clearAllWhitelist();
      _whitelist  = [];
      _sessionPin = null;
      closeModal('modal-clear-whitelist-confirm');
      showWhitelistLocked();
      toast('All domains removed', 'info');
    } catch (err) {
      toast(`Failed: ${err.message}`, 'error');
    }
  });

  // ════════════════════════════════════════════════════════
  //  API KEY
  // ════════════════════════════════════════════════════════

  let hasApiKey = false;

  let _pendingApiKey = null;

  const _svgCheck = `<svg class="status-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
  const _svgInfo  = `<svg class="status-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`;

  async function renderApiKeyPage() {
    currentPageForPin = 'API Key';
    const cfg = await window.uniprint.getConfig();
    hasApiKey = cfg.hasApiKey;

    const banner = document.getElementById('apikey-pin-banner');
    if (cfg.hasAccountPin && cfg.accountPinSetPage !== 'API Key') {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }

    const statusEl   = document.getElementById('apikey-status-text');
    const clearBtn   = document.getElementById('btn-clear-apikey');
    const revealCard = document.getElementById('reveal-card');
    if (hasApiKey) {
      statusEl.innerHTML = `<span class="apikey-status-ok">${_svgCheck}API key configured</span>`;
      clearBtn.classList.remove('hidden');
      revealCard.classList.remove('hidden');
    } else {
      statusEl.innerHTML = `<span class="apikey-status-none">${_svgInfo}No API key set</span>`;
      clearBtn.classList.add('hidden');
      revealCard.classList.add('hidden');
    }
  }

  // Set new API key
  document.getElementById('btn-set-apikey').addEventListener('click', () => {
    const input = document.getElementById('apikey-input');
    const value = input.value.trim();
    if (!value) return;
    if (value.length < 16) {
      toast('API key must be at least 16 characters', 'error');
      return;
    }
    _pendingApiKey  = value;
    input.value     = '';
    currentPageForPin = 'API Key';
    withAccountPin('API Key', async (pin) => {
      try {
        await window.uniprint.setApiKey(_pendingApiKey, pin);
        _pendingApiKey = null;
        hasApiKey = true;
        await renderApiKeyPage();
        toast('API key saved', 'success');
      } catch (err) {
        toast(`Failed to save key: ${err.message}`, 'error');
        _pendingApiKey = null;
      }
    });
  });

  document.getElementById('apikey-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-set-apikey').click();
  });

  // Reveal API key
  document.getElementById('btn-reveal-apikey').addEventListener('click', () => {
    currentPageForPin = 'API Key';
    withAccountPin('API Key', async (pin) => {
      const key = await window.uniprint.revealApiKey(pin);
      if (key === null) {
        toast('Could not decrypt key. Try clearing and re-entering.', 'error');
        return;
      }
      document.getElementById('key-display-value').textContent = key;
      openModal('modal-key-display');
    });
  });

  // Key display modal
  document.getElementById('btn-key-display-close').addEventListener('click', () => {
    document.getElementById('key-display-value').textContent = '';
    closeModal('modal-key-display');
  });

  document.getElementById('btn-key-display-copy').addEventListener('click', async () => {
    const key = document.getElementById('key-display-value').textContent;
    try {
      await window.uniprint.copyToClipboard(key);
      toast('API key copied to clipboard', 'success');
    } catch {
      toast('Failed to copy', 'error');
    }
  });

  // Delete API key (no PIN required — just confirmation)
  document.getElementById('btn-clear-apikey').addEventListener('click', () => {
    openModal('modal-clear-apikey-confirm');
  });

  document.getElementById('btn-clear-apikey-cancel').addEventListener('click', () => {
    closeModal('modal-clear-apikey-confirm');
  });

  document.getElementById('btn-clear-apikey-ok').addEventListener('click', async () => {
    try {
      await window.uniprint.clearApiKey();
      hasApiKey   = false;
      _sessionPin = null;
      closeModal('modal-clear-apikey-confirm');
      await renderApiKeyPage();
      toast('API key deleted', 'info');
    } catch (err) {
      toast(`Failed: ${err.message}`, 'error');
    }
  });

  // ════════════════════════════════════════════════════════
  //  LOGS
  // ════════════════════════════════════════════════════════

  function appendLogEntry(entry) {
    const container = document.getElementById('log-container');
    if (!container) return;
    const ts         = entry.timestamp ? entry.timestamp.split('T')[1].replace('Z', '').slice(0, 12) : '';
    const levelClass = `log-level-${entry.level || 'info'}`;
    const el         = document.createElement('div');
    el.className     = 'log-entry';
    el.innerHTML     = `
      <span class="log-ts">${escHtml(ts)}</span>
      <span class="log-level ${escHtml(levelClass)}">${escHtml((entry.level || 'info').toUpperCase())}</span>
      <span class="log-msg">${escHtml(entry.message || '')}</span>
    `;
    container.appendChild(el);
    if (logAutoscroll) container.scrollTop = container.scrollHeight;
  }

  async function loadLogs() {
    const container = document.getElementById('log-container');
    if (!container) return;
    container.innerHTML = '';
    try {
      const logs = await window.uniprint.getLogs();
      if (!logs || logs.length === 0) {
        container.innerHTML = '<div class="empty-state">No log entries yet.</div>';
        return;
      }
      logs.forEach(appendLogEntry);
    } catch {}
  }

  window.uniprint.onLog(entry => {
    if (currentTab === 'logs') appendLogEntry(entry);
  });

  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    const container = document.getElementById('log-container');
    if (container) container.innerHTML = '';
  });

  // ════════════════════════════════════════════════════════
  //  UPDATES
  // ════════════════════════════════════════════════════════

  let _updateCheckTimer = null;

  function clearUpdateCheckTimer() {
    if (_updateCheckTimer) { clearTimeout(_updateCheckTimer); _updateCheckTimer = null; }
  }

  async function loadVersion() {
    try {
      const version = await window.uniprint.getVersion();
      const el = document.getElementById('update-version');
      if (el) el.textContent = version || '—';
    } catch {}
  }

  document.getElementById('btn-check-update').addEventListener('click', async () => {
    const statusEl = document.getElementById('update-status-text');
    statusEl.textContent = 'Checking for updates...';
    clearUpdateCheckTimer();

    _updateCheckTimer = setTimeout(() => {
      statusEl.textContent = 'Could not reach the update server. Check your internet connection.';
      _updateCheckTimer = null;
    }, 12000);

    try {
      await window.uniprint.checkForUpdates();
    } catch {
      // IPC-level failure (not a normal update-check error; those arrive via onUpdateError)
      clearUpdateCheckTimer();
      statusEl.textContent = 'Could not connect to the update service.';
    }
  });

  document.getElementById('btn-install-update').addEventListener('click', () => {
    window.uniprint.installUpdate();
  });

  window.uniprint.onUpdateChecking(() => {
    document.getElementById('update-status-text').textContent = 'Checking for updates...';
  });

  window.uniprint.onUpdateAvailable(info => {
    clearUpdateCheckTimer();
    document.getElementById('update-status-text').textContent = `Update available: v${info.version}`;
    toast(`Update available: v${info.version}`, 'info');
  });

  window.uniprint.onUpdateNotAvailable(() => {
    clearUpdateCheckTimer();
    document.getElementById('update-status-text').textContent = 'You are running the latest version.';
  });

  window.uniprint.onUpdateProgress(progress => {
    clearUpdateCheckTimer();
    const pct   = Math.round(progress.percent || 0);
    document.getElementById('update-status-text').textContent = 'Downloading update...';
    const wrap  = document.getElementById('update-progress-wrap');
    const fill  = document.getElementById('update-progress-fill');
    const pctEl = document.getElementById('update-progress-pct');
    if (wrap)  wrap.classList.remove('hidden');
    if (fill)  fill.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct}%`;
  });

  window.uniprint.onUpdateDownloaded(info => {
    clearUpdateCheckTimer();
    document.getElementById('update-status-text').textContent = `v${info.version} downloaded — click "Restart & Update" to install, or it will install automatically when you next close UniPrint.`;
    const wrap = document.getElementById('update-progress-wrap');
    if (wrap) wrap.classList.add('hidden');
    const installBtn = document.getElementById('btn-install-update');
    if (installBtn) installBtn.classList.remove('hidden');
    toast(`v${info.version} ready to install — no installer wizard required.`, 'success');
  });

  window.uniprint.onUpdateError(data => {
    clearUpdateCheckTimer();
    document.getElementById('update-status-text').textContent = `Update error: ${data.message}`;
    toast(`Update error: ${data.message}`, 'error');
  });

  // ════════════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════════════

  async function init() {
    try {
      const cfg = await window.uniprint.getConfig();
      selectedPrinterConfig = cfg.selectedPrinter;
    } catch {}

    await loadPort();
    await refreshStatus();
    showTab('dashboard');
    statusPollInterval = setInterval(refreshStatus, 5000);
  }

  init();
})();
