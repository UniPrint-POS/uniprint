const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uniprint', {
  // ── Config ─────────────────────────────────────────────
  getConfig:           ()          => ipcRenderer.invoke('config:get'),
  setConfig:           (key, val)  => ipcRenderer.invoke('config:set', key, val),

  // ── Account PIN ─────────────────────────────────────────
  setupAccountPin:     (pin, page) => ipcRenderer.invoke('account:setupPin', pin, page),
  verifyAccountPin:    (pin)       => ipcRenderer.invoke('account:verifyPin', pin),

  // ── API Key ─────────────────────────────────────────────
  setApiKey:           (key, pin)  => ipcRenderer.invoke('config:setApiKey', key, pin),
  clearApiKey:         ()          => ipcRenderer.invoke('config:clearApiKey'),
  revealApiKey:        (pin)       => ipcRenderer.invoke('config:revealApiKey', pin),

  // ── Whitelist ───────────────────────────────────────────
  viewWhitelist:       (pin)                        => ipcRenderer.invoke('whitelist:view', pin),
  addToWhitelist:      (origin, pin)                => ipcRenderer.invoke('whitelist:add', origin, pin),
  removeFromWhitelist: (origin, pin)                => ipcRenderer.invoke('whitelist:remove', origin, pin),
  updateWhitelist:     (oldOrigin, newOrigin, pin)  => ipcRenderer.invoke('whitelist:update', oldOrigin, newOrigin, pin),
  clearAllWhitelist:   ()                           => ipcRenderer.invoke('whitelist:clearAll'),

  // ── Clipboard ───────────────────────────────────────────
  copyToClipboard:     (text)      => ipcRenderer.invoke('clipboard:write', text),

  // ── Printer ─────────────────────────────────────────────
  testPrint:           ()          => ipcRenderer.invoke('printer:test'),
  listPrinters:        ()          => ipcRenderer.invoke('printer:list'),
  getStatus:           ()          => ipcRenderer.invoke('printer:status'),
  connectPrinter:      ()          => ipcRenderer.invoke('printer:connect'),
  selectPrinter:       (cfg)       => ipcRenderer.invoke('printer:select', cfg),

  // ── Logs ────────────────────────────────────────────────
  getLogs:             ()          => ipcRenderer.invoke('logs:get'),
  onLog:               (cb)        => ipcRenderer.on('log:entry', (_, e) => cb(e)),

  // ── Server ──────────────────────────────────────────────
  getServerPort:       ()          => ipcRenderer.invoke('server:port'),

  // ── Updates ─────────────────────────────────────────────
  getVersion:          ()          => ipcRenderer.invoke('updater:version'),
  checkForUpdates:     ()          => ipcRenderer.invoke('updater:check'),
  installUpdate:       ()          => ipcRenderer.invoke('updater:install'),
  onUpdateChecking:    (cb)        => ipcRenderer.on('update:checking',     (_, d) => cb(d)),
  onUpdateAvailable:   (cb)        => ipcRenderer.on('update:available',    (_, d) => cb(d)),
  onUpdateNotAvailable:(cb)        => ipcRenderer.on('update:not-available',(_, d) => cb(d)),
  onUpdateProgress:    (cb)        => ipcRenderer.on('update:progress',     (_, d) => cb(d)),
  onUpdateDownloaded:  (cb)        => ipcRenderer.on('update:downloaded',   (_, d) => cb(d)),
  onUpdateError:       (cb)        => ipcRenderer.on('update:error',        (_, d) => cb(d)),

  reportCspViolation:  (data)      => ipcRenderer.send('csp:violation', data),
});
