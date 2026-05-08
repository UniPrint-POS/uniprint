const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

class TrayManager {
  constructor(win) {
    this._win = win;
    this._tray = null;
  }

  create() {
    let icon;
    try {
      const assetsDir = app.isPackaged
        ? path.join(process.resourcesPath, 'assets')
        : path.join(__dirname, '../assets');
      const icoPath = path.join(assetsDir, 'uniprint.ico');
      const pngPath = path.join(assetsDir, 'uniprint.png');
      icon = nativeImage.createFromPath(icoPath);
      if (icon.isEmpty()) icon = nativeImage.createFromPath(pngPath);
      if (icon.isEmpty()) throw new Error('No icon found');
    } catch {
      icon = nativeImage.createEmpty();
    }

    this._tray = new Tray(icon);
    this._tray.setToolTip('UniPrint - Offline');
    this._buildMenu();

    this._tray.on('double-click', () => {
      if (this._win) {
        this._win.show();
        this._win.focus();
      }
    });
  }

  _buildMenu() {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open UniPrint',
        click: () => {
          if (this._win) {
            this._win.show();
            this._win.focus();
          }
        },
      },
      {
        label: 'Check for Updates',
        click: () => {
          const { autoUpdater } = require('electron-updater');
          autoUpdater.checkForUpdates().catch(() => {});
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuiting = true;
          app.quit();
        },
      },
    ]);
    if (this._tray) this._tray.setContextMenu(menu);
  }

  update(connected) {
    if (!this._tray) return;
    this._tray.setToolTip(connected ? 'UniPrint - Printer connected' : 'UniPrint - Printer offline');
  }

  destroy() {
    if (this._tray) {
      this._tray.destroy();
      this._tray = null;
    }
  }
}

module.exports = TrayManager;
