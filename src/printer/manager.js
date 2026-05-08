const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { format } = require('./formatter');

const execAsync = promisify(exec);

const THERMAL_VIDS = new Set([
  0x04b8, 0x0519, 0x0dd4, 0x154f, 0x0483, 0x6868,
  0x1fc9, 0x28e9, 0x20d1, 0x0525, 0x3513, 0x1a86,
]);

let usb;
try {
  usb = require('usb');
} catch {
  usb = null;
}

class PrinterManager {
  constructor(config, logger) {
    this._config = config;
    this._logger = logger;
    this._device = null;
    this._endpoint = null;
    this._windowsPrinter = null;
    this._mode = null;
    this._debounceTimer = null;
    this._statusListeners = new Set();
  }

  onStatusChange(fn) {
    this._statusListeners.add(fn);
    return () => this._statusListeners.delete(fn);
  }

  _notifyStatus() {
    const status = this.getStatus();
    for (const fn of this._statusListeners) {
      try { fn(status); } catch {}
    }
  }

  async listAll() {
    const results = [];

    if (usb) {
      try {
        const devices = usb.getDeviceList();
        for (const dev of devices) {
          const vid = dev.deviceDescriptor.idVendor;
          const pid = dev.deviceDescriptor.idProduct;
          if (THERMAL_VIDS.has(vid)) {
            results.push({
              type: 'usb',
              name: `USB Printer ${vid.toString(16).toUpperCase()}:${pid.toString(16).toUpperCase()}`,
              vid,
              pid,
              portName: null,
            });
          }
        }
      } catch (err) {
        this._logger.warn(`USB scan error: ${err.message}`);
      }
    }

    try {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "Get-Printer | Select-Object Name,PortName | ConvertTo-Json"',
        { timeout: 8000 }
      );
      const parsed = JSON.parse(stdout.trim());
      const printers = Array.isArray(parsed) ? parsed : [parsed];
      for (const p of printers) {
        results.push({
          type: 'windows',
          name: p.Name || 'Unknown Printer',
          vid: null,
          pid: null,
          portName: p.PortName || null,
        });
      }
    } catch (err) {
      this._logger.warn(`Windows printer list error: ${err.message}`);
    }

    return results;
  }

  async connect(printerConfig) {
    if (!printerConfig) return;
    this.disconnect();
    try {
      if (printerConfig.type === 'usb' && usb) {
        await this.connectUsb(printerConfig.vid, printerConfig.pid);
      } else if (printerConfig.type === 'windows') {
        await this.connectWindows(printerConfig.name);
      }
      this._logger.info(`Printer connected: ${printerConfig.name}`);
      this._notifyStatus();
    } catch (err) {
      this._logger.error(`Printer connect failed: ${err.message}`);
      this._notifyStatus();
    }
  }

  async connectUsb(vid, pid) {
    if (!usb) throw new Error('USB module not available');
    const device = usb.findByIds(vid, pid);
    if (!device) throw new Error(`USB device ${vid}:${pid} not found`);

    device.open();
    const iface = device.interfaces.find(i => {
      for (const ep of i.endpoints) {
        if (ep.direction === 'out') return true;
      }
      return false;
    });
    if (!iface) throw new Error('No suitable interface found');

    if (iface.isKernelDriverActive()) {
      iface.detachKernelDriver();
    }
    iface.claim();

    const endpoint = iface.endpoints.find(ep => ep.direction === 'out');
    if (!endpoint) throw new Error('No bulk-out endpoint found');

    this._device = device;
    this._endpoint = endpoint;
    this._mode = 'usb';
    this._windowsPrinter = null;
  }

  async connectWindows(name) {
    this._windowsPrinter = name;
    this._mode = 'windows';
    this._device = null;
    this._endpoint = null;
  }

  disconnect() {
    if (this._device) {
      try {
        if (this._endpoint) {
          const iface = this._endpoint.interface;
          iface.release(true, () => {});
        }
        this._device.close();
      } catch {}
      this._device = null;
      this._endpoint = null;
    }
    this._mode = null;
    this._windowsPrinter = null;
  }

  isConnected() {
    return this._mode === 'usb' ? (this._device !== null && this._endpoint !== null) :
      this._mode === 'windows' ? this._windowsPrinter !== null :
      false;
  }

  getStatus() {
    const connected = this.isConnected();
    let name = null;
    if (this._mode === 'windows' && this._windowsPrinter) {
      name = this._windowsPrinter;
    } else if (this._mode === 'usb' && this._device) {
      const d = this._device.deviceDescriptor;
      name = `USB ${d.idVendor.toString(16)}:${d.idProduct.toString(16)}`;
    }
    return { connected, mode: this._mode, name };
  }

  async printJob(job) {
    const paperWidth = this._config.get('paperWidth') || 80;
    const buffer = format(job.template, job.data || {}, paperWidth);

    if (this._mode === 'usb') {
      await this.printUsb(buffer);
    } else if (this._mode === 'windows') {
      await this.printWindows(buffer);
    } else {
      throw new Error('No printer connected');
    }
  }

  async printUsb(buffer) {
    if (!this._endpoint) throw new Error('USB endpoint not available');
    const CHUNK = 64;
    for (let i = 0; i < buffer.length; i += CHUNK) {
      const chunk = buffer.slice(i, i + CHUNK);
      await new Promise((resolve, reject) => {
        this._endpoint.transfer(chunk, err => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  async printWindows(buffer) {
    const printerName = this._windowsPrinter;
    if (!printerName) throw new Error('No Windows printer configured');

    const tmpFile = path.join(os.tmpdir(), `uniprint-${Date.now()}.prn`);
    fs.writeFileSync(tmpFile, buffer);

    const ps = `
$bytes = [System.IO.File]::ReadAllBytes('${tmpFile.replace(/'/g, "''")}')
$printerName = '${printerName.replace(/'/g, "''")}'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public struct DOCINFO {
    public string pDocName;
    public string pOutputFile;
    public string pDatatype;
  }
  [DllImport("winspool.drv", CharSet=CharSet.Ansi)]
  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv")]
  public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Ansi)]
  public static extern int StartDocPrinter(IntPtr h, int l, ref DOCINFO i);
  [DllImport("winspool.drv")]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv")]
  public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  [DllImport("winspool.drv")]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv")]
  public static extern bool EndDocPrinter(IntPtr h);
}
'@
$hp = [IntPtr]::Zero
[RawPrint]::OpenPrinter($printerName, [ref]$hp, [IntPtr]::Zero) | Out-Null
$di = New-Object RawPrint+DOCINFO
$di.pDocName = 'UniPrint'
$di.pDatatype = 'RAW'
[RawPrint]::StartDocPrinter($hp, 1, [ref]$di) | Out-Null
[RawPrint]::StartPagePrinter($hp) | Out-Null
$written = 0
[RawPrint]::WritePrinter($hp, $bytes, $bytes.Length, [ref]$written) | Out-Null
[RawPrint]::EndPagePrinter($hp) | Out-Null
[RawPrint]::EndDocPrinter($hp) | Out-Null
[RawPrint]::ClosePrinter($hp) | Out-Null
`;

    try {
      await execAsync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { timeout: 15000 });
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  setupHotplug() {
    if (!usb) return;
    try {
      usb.on('attach', () => {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this.tryReconnect(), 800);
      });
      usb.on('detach', () => {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
          if (this._mode === 'usb') {
            this._logger.warn('USB printer detached');
            this._device = null;
            this._endpoint = null;
            this._mode = null;
            this._notifyStatus();
          }
        }, 800);
      });
    } catch (err) {
      this._logger.warn(`Hotplug setup failed: ${err.message}`);
    }
  }

  async tryReconnect() {
    const cfg = this._config.get('selectedPrinter');
    if (cfg) {
      this._logger.info('Attempting printer reconnect...');
      await this.connect(cfg);
    }
  }
}

module.exports = PrinterManager;
