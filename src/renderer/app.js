(function () {
  'use strict';

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  let currentTab = 'dashboard';
  let statusPollInterval = null;
  let logAutoscroll = true;

  const tabs = ['dashboard', 'printers', 'whitelist', 'apikey', 'logs', 'updates'];

  function showTab(tabId) {
    currentTab = tabId;
    tabs.forEach(id => {
      const section = document.getElementById(`tab-${id}`);
      const btn = document.querySelector(`[data-tab="${id}"]`);
      if (section) section.classList.toggle('hidden', id !== tabId);
      if (btn) btn.classList.toggle('active', id === tabId);
    });
    if (tabId === 'printers') loadPrinters();
    if (tabId === 'logs') loadLogs();
    if (tabId === 'updates') loadVersion();
    if (tabId === 'whitelist') renderWhitelist();
    if (tabId === 'apikey') renderApiKeyStatus();
  }

  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  function updateStatusBadge(connected) {
    const badge = document.getElementById('header-status');
    if (connected) {
      badge.textContent = 'Online';
      badge.className = 'status-badge online';
    } else {
      badge.textContent = 'Offline';
      badge.className = 'status-badge offline';
    }
  }

  async function refreshStatus() {
    try {
      const status = await window.uniprint.getStatus();
      const connected = status && status.connected;
      updateStatusBadge(connected);

      const printerEl = document.getElementById('stat-printer');
      if (printerEl) {
        printerEl.textContent = connected ? 'Connected' : 'Offline';
        printerEl.className = `stat-value ${connected ? 'green' : 'red'}`;
      }

      const queueEl = document.getElementById('stat-queue');
      if (queueEl) queueEl.textContent = status ? String(status.queue || 0) : '0';
    } catch {}
  }

  async function loadPort() {
    try {
      const port = await window.uniprint.getServerPort();
      const el = document.getElementById('port-info');
      if (el && port) el.textContent = `Listening on port: ${port}`;
    } catch {}
  }

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
    const box = document.getElementById('selected-printer-info');
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
      const isSelected = selectedPrinterConfig && selectedPrinterConfig.name === p.name && selectedPrinterConfig.type === p.type;
      const badgeClass = p.type === 'usb' ? 'badge-usb' : 'badge-windows';
      const badgeLabel = p.type === 'usb' ? 'USB' : 'Windows';
      return `<div class="printer-item ${isSelected ? 'selected' : ''}">
        <div class="printer-info">
          <span class="badge ${escHtml(badgeClass)}">${escHtml(badgeLabel)}</span>
          <span class="printer-name">${escHtml(p.name)}</span>
          ${p.portName ? `<span style="color:var(--text-dim);font-size:12px">${escHtml(p.portName)}</span>` : ''}
        </div>
        <button class="btn btn-primary" data-printer-idx="${i}" ${isSelected ? 'disabled' : ''}>${isSelected ? 'Selected' : 'Select'}</button>
      </div>`;
    }).join('');

    listEl.querySelectorAll('[data-printer-idx]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.printerIdx, 10);
        const printer = allPrinters[idx];
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

  let whitelist = [];

  async function loadWhitelist() {
    try {
      const cfg = await window.uniprint.getConfig();
      whitelist = cfg.whitelist || [];
    } catch {
      whitelist = [];
    }
  }

  function renderWhitelist() {
    const listEl = document.getElementById('whitelist-list');
    if (!whitelist.length) {
      listEl.innerHTML = '<div class="empty-state">No domains whitelisted. All print requests are blocked.</div>';
      return;
    }
    listEl.innerHTML = whitelist.map(origin => `
      <div class="whitelist-item">
        <span class="whitelist-origin">${escHtml(origin)}</span>
        <button class="whitelist-remove" data-origin="${escHtml(origin)}" title="Remove">&times;</button>
      </div>
    `).join('');
    listEl.querySelectorAll('.whitelist-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const origin = btn.dataset.origin;
        try {
          const updated = await window.uniprint.removeFromWhitelist(origin);
          whitelist = updated.whitelist || [];
          renderWhitelist();
        } catch (err) {
          toast(`Remove failed: ${err.message}`, 'error');
        }
      });
    });
  }

  document.getElementById('btn-add-whitelist').addEventListener('click', async () => {
    const input = document.getElementById('whitelist-input');
    const value = input.value.trim();
    if (!value) return;

    try {
      new URL(value);
    } catch {
      toast('Invalid URL format. Use https://yourapp.com', 'error');
      return;
    }

    try {
      const updated = await window.uniprint.addToWhitelist(value);
      whitelist = updated.whitelist || [];
      input.value = '';
      renderWhitelist();
      toast('Origin added to whitelist', 'success');
    } catch (err) {
      toast(`Failed to add: ${err.message}`, 'error');
    }
  });

  document.getElementById('whitelist-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-add-whitelist').click();
  });

  let hasApiKey = false;

  async function renderApiKeyStatus() {
    try {
      const cfg = await window.uniprint.getConfig();
      hasApiKey = cfg.hasApiKey;
      const statusEl = document.getElementById('apikey-status-text');
      const clearBtn = document.getElementById('btn-clear-apikey');
      if (hasApiKey) {
        statusEl.innerHTML = '<span style="color:var(--green);font-weight:700">&#10003; API key configured</span>';
        clearBtn.classList.remove('hidden');
      } else {
        statusEl.innerHTML = '<span style="color:var(--red);font-weight:700">&#10007; No API key set</span>';
        clearBtn.classList.add('hidden');
      }
    } catch {}
  }

  document.getElementById('btn-set-apikey').addEventListener('click', async () => {
    const input = document.getElementById('apikey-input');
    const value = input.value.trim();
    if (!value) return;
    if (value.length < 16) {
      toast('API key must be at least 16 characters', 'error');
      return;
    }
    try {
      await window.uniprint.setApiKey(value);
      input.value = '';
      hasApiKey = true;
      await renderApiKeyStatus();
      toast('API key saved', 'success');
    } catch (err) {
      toast(`Failed to set key: ${err.message}`, 'error');
    }
  });

  document.getElementById('apikey-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-set-apikey').click();
  });

  document.getElementById('btn-clear-apikey').addEventListener('click', async () => {
    try {
      await window.uniprint.clearApiKey();
      hasApiKey = false;
      await renderApiKeyStatus();
      toast('API key cleared', 'info');
    } catch (err) {
      toast(`Failed to clear key: ${err.message}`, 'error');
    }
  });

  function appendLogEntry(entry) {
    const container = document.getElementById('log-container');
    if (!container) return;
    const ts = entry.timestamp ? entry.timestamp.split('T')[1].replace('Z', '').slice(0, 12) : '';
    const levelClass = `log-level-${entry.level || 'info'}`;
    const el = document.createElement('div');
    el.className = 'log-entry';
    el.innerHTML = `
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

  async function loadVersion() {
    try {
      const version = await window.uniprint.getVersion();
      const el = document.getElementById('update-version');
      if (el) el.textContent = version || '—';
    } catch {}
  }

  document.getElementById('btn-check-update').addEventListener('click', async () => {
    try {
      await window.uniprint.checkForUpdates();
      document.getElementById('update-status-text').textContent = 'Checking...';
    } catch (err) {
      toast(`Update check failed: ${err.message}`, 'error');
    }
  });

  document.getElementById('btn-install-update').addEventListener('click', () => {
    window.uniprint.installUpdate();
  });

  window.uniprint.onUpdateChecking(() => {
    document.getElementById('update-status-text').textContent = 'Checking for updates...';
  });

  window.uniprint.onUpdateAvailable(info => {
    document.getElementById('update-status-text').textContent = `Update available: v${info.version}`;
    toast(`Update available: v${info.version}`, 'info');
  });

  window.uniprint.onUpdateNotAvailable(() => {
    document.getElementById('update-status-text').textContent = 'You are on the latest version.';
  });

  window.uniprint.onUpdateProgress(progress => {
    const pct = Math.round(progress.percent || 0);
    document.getElementById('update-status-text').textContent = `Downloading update...`;
    const wrap = document.getElementById('update-progress-wrap');
    const fill = document.getElementById('update-progress-fill');
    const pctEl = document.getElementById('update-progress-pct');
    if (wrap) wrap.classList.remove('hidden');
    if (fill) fill.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct}%`;
  });

  window.uniprint.onUpdateDownloaded(info => {
    document.getElementById('update-status-text').textContent = `Ready to install: v${info.version}`;
    const wrap = document.getElementById('update-progress-wrap');
    if (wrap) wrap.classList.add('hidden');
    const installBtn = document.getElementById('btn-install-update');
    if (installBtn) installBtn.classList.remove('hidden');
    toast(`Update ready: v${info.version}. Click Install & Restart.`, 'success');
  });

  window.uniprint.onUpdateError(data => {
    document.getElementById('update-status-text').textContent = `Update error: ${data.message}`;
    toast(`Update error: ${data.message}`, 'error');
  });

  async function init() {
    try {
      const cfg = await window.uniprint.getConfig();
      whitelist = cfg.whitelist || [];
      hasApiKey = cfg.hasApiKey;
      selectedPrinterConfig = cfg.selectedPrinter;
    } catch {}

    await loadPort();
    await refreshStatus();

    showTab('dashboard');

    statusPollInterval = setInterval(refreshStatus, 5000);
  }

  init();
})();
