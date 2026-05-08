const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

app.disableHardwareAcceleration();

const { logger, onEntry, getBuffer, setApp } = require('./utils/logger');
const config = require('./utils/config');
const PrinterManager = require('./printer/manager');
const PrintQueue = require('./printer/queue');
const server = require('./server/index');
const TrayManager = require('./tray');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let win = null;
let tray = null;
let serverPort = null;
let printerManager = null;
let queue = null;

const CONFIG_ALLOWLIST = ['paperWidth', 'autoStart', 'selectedPrinter'];

function cleanupTempFiles() {
  try {
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    for (const f of files) {
      if (f.startsWith('uniprint-') && f.endsWith('.prn')) {
        try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
      }
    }
  } catch {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 700,
    minHeight: 500,
    show: false,
    backgroundColor: '#09090f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: process.env.NODE_ENV === 'development',
    },
    icon: path.join(__dirname, '../assets/uniprint.ico'),
    titleBarStyle: 'default',
    autoHideMenuBar: true,
  });

  win.loadFile(path.join(__dirname, 'renderer/index.html'));

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      win.hide();
    }
  });

  if (process.env.NODE_ENV === 'production') {
    win.webContents.on('before-input-event', (e, input) => {
      if (
        input.key === 'F12' ||
        (input.control && input.shift && ['I', 'J', 'C'].includes(input.key))
      ) {
        e.preventDefault();
      }
    });
  }

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return win;
}

function setupIpc() {
  ipcMain.handle('config:get', () => config.getAll());

  ipcMain.handle('config:set', (_, key, value) => {
    if (!CONFIG_ALLOWLIST.includes(key)) throw new Error('Key not allowed');
    config.set(key, value);
    if (key === 'autoStart') {
      app.setLoginItemSettings({ openAtLogin: value === true });
    }
    return true;
  });

  // ── Account PIN ──────────────────────────────────────────

  ipcMain.handle('account:setupPin', (_, pin, page) => {
    config.setupAccountPin(pin, page);
    return true;
  });

  ipcMain.handle('account:verifyPin', (_, pin) => {
    return config.verifyAccountPin(pin);
  });

  // ── API Key ──────────────────────────────────────────────

  ipcMain.handle('config:setApiKey', (_, key, pin) => {
    config.setApiKey(key, pin);
    return true;
  });

  ipcMain.handle('config:clearApiKey', () => {
    config.clearApiKey();
    return true;
  });

  ipcMain.handle('config:revealApiKey', (_, pin) => {
    return config.revealApiKey(pin);
  });

  // ── Whitelist ────────────────────────────────────────────

  ipcMain.handle('whitelist:view', (_, pin) => {
    if (!config.verifyAccountPin(pin)) return null;
    return config.getWhitelist();
  });

  ipcMain.handle('whitelist:add', (_, origin, pin) => {
    if (!config.verifyAccountPin(pin)) throw new Error('Incorrect PIN');
    config.addToWhitelist(origin);
    return config.getWhitelist();
  });

  ipcMain.handle('whitelist:remove', (_, origin, pin) => {
    if (!config.verifyAccountPin(pin)) throw new Error('Incorrect PIN');
    config.removeFromWhitelist(origin);
    return config.getWhitelist();
  });

  ipcMain.handle('whitelist:update', (_, oldOrigin, newOrigin, pin) => {
    if (!config.verifyAccountPin(pin)) throw new Error('Incorrect PIN');
    config.removeFromWhitelist(oldOrigin);
    config.addToWhitelist(newOrigin);
    return config.getWhitelist();
  });

  ipcMain.handle('whitelist:clearAll', () => {
    config.clearWhitelist();
    return true;
  });

  // ── Clipboard ────────────────────────────────────────────

  ipcMain.handle('clipboard:write', (_, text) => {
    clipboard.writeText(String(text));
    return true;
  });

  ipcMain.handle('printer:test', () => {
    return queue.enqueue({ template: 'test', data: {} });
  });

  ipcMain.handle('printer:list', async () => {
    return printerManager.listAll();
  });

  ipcMain.handle('printer:status', () => {
    return printerManager.getStatus();
  });

  ipcMain.handle('printer:connect', async () => {
    await printerManager.tryReconnect();
    return printerManager.getStatus();
  });

  ipcMain.handle('printer:select', async (_, cfg) => {
    config.set('selectedPrinter', cfg);
    await printerManager.connect(cfg);
    return printerManager.getStatus();
  });

  ipcMain.handle('logs:get', () => getBuffer());

  ipcMain.handle('server:port', () => serverPort);

  ipcMain.on('csp:violation', (_, data) => {
    logger.warn(`CSP violation: ${JSON.stringify(data)}`);
  });

  ipcMain.handle('updater:version', () => app.getVersion());

  ipcMain.handle('updater:check', async () => {
    if (app.isPackaged) {
      const { autoUpdater } = require('electron-updater');
      return autoUpdater.checkForUpdates();
    }
    setTimeout(() => {
      if (win) win.webContents.send('update:not-available', {});
    }, 800);
    return null;
  });

  ipcMain.handle('updater:install', () => {
    if (app.isPackaged) {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.quitAndInstall();
    }
  });
}

function setupUpdater() {
  if (!app.isPackaged) return;

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    if (win) win.webContents.send('update:checking');
  });

  autoUpdater.on('update-available', (info) => {
    if (win) win.webContents.send('update:available', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    if (win) win.webContents.send('update:not-available', info);
  });

  autoUpdater.on('download-progress', (progress) => {
    if (win) win.webContents.send('update:progress', progress);
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (win) win.webContents.send('update:downloaded', info);
  });

  autoUpdater.on('error', (err) => {
    logger.error(`Updater error: ${err.message}`);
    if (win) win.webContents.send('update:error', { message: err.message });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => logger.warn(`Update check failed: ${err.message}`));
  }, 30000);

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(err => logger.warn(`Update check failed: ${err.message}`));
  }, 4 * 60 * 60 * 1000);
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('activate', () => {
  if (win) {
    win.show();
    win.focus();
  }
});

app.whenReady().then(async () => {
  setApp(app);
  cleanupTempFiles();

  printerManager = new PrinterManager(config, logger);

  queue = new PrintQueue(job => printerManager.printJob(job));

  const ipcEmitter = {
    showPairRequest(origin, appName) {
      return dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Allow', 'Deny'],
        defaultId: 1,
        cancelId: 1,
        title: 'Pairing Request',
        message: `${appName} wants to connect`,
        detail: `Origin: ${origin}\n\nAllow this website to send print jobs to UniPrint?`,
      }).then(result => result.response === 0);
    },
  };

  createWindow();
  tray = new TrayManager(win);
  tray.create();

  setupIpc();

  try {
    const result = await server.start(printerManager, queue, ipcEmitter);
    serverPort = result.port;
    logger.info(`Server started on port ${serverPort}`);
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
  }

  const savedPrinter = config.get('selectedPrinter');
  if (savedPrinter) {
    printerManager.connect(savedPrinter).catch(err => {
      logger.warn(`Initial printer connect failed: ${err.message}`);
    });
  }

  printerManager.setupHotplug();

  printerManager.onStatusChange(status => {
    if (tray) tray.update(status.connected);
    if (win && !win.isDestroyed()) {
      win.webContents.send('printer:status-change', status);
    }
  });

  queue.on('enqueued', (data) => {
    const ws = require('./server/websocket');
    ws.broadcast('job:enqueued', data);
  });

  queue.on('processing', (data) => {
    const ws = require('./server/websocket');
    ws.broadcast('job:processing', data);
  });

  queue.on('done', (data) => {
    const ws = require('./server/websocket');
    ws.broadcast('job:done', data);
  });

  queue.on('failed', (data) => {
    const ws = require('./server/websocket');
    ws.broadcast('job:failed', data);
  });

  queue.on('error', (data) => {
    logger.error(`Print job error: ${data.error} (attempt ${data.attempt})`);
  });

  onEntry(entry => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('log:entry', entry);
    }
  });

  setupUpdater();

  const autoStart = config.get('autoStart');
  if (autoStart) {
    app.setLoginItemSettings({ openAtLogin: true });
  }
});

app.on('before-quit', () => {
  app.isQuiting = true;
});
