# UniPrint

**UniPrint** is a lightweight Electron desktop application that runs a secure local HTTP server on Windows, bridging your web-based POS system to USB and Windows thermal printers — no cloud, no drivers to configure, no third-party services.

Your website sends a single `POST` request to `http://127.0.0.1:PORT/print`. UniPrint receives it, renders the receipt or label, and sends the raw ESC/POS commands directly to the printer.

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Requirements](#requirements)
3. [Installation](#installation)
4. [First-Time Setup](#first-time-setup)
5. [Port Discovery & Fallback](#port-discovery--fallback)
6. [API Reference](#api-reference)
7. [Integrating with Your POS Website](#integrating-with-your-pos-website)
8. [Print Templates](#print-templates)
9. [WebSocket Integration](#websocket-integration)
10. [Security Model](#security-model)
11. [Building from Source](#building-from-source)
12. [Troubleshooting](#troubleshooting)

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                        Windows PC                           │
│                                                             │
│   ┌─────────────────┐    HTTP/WS      ┌──────────────────┐  │
│   │  Your POS Web   │ ─────────────► │    UniPrint      │  │
│   │  Application    │  127.0.0.1     │  Local Server    │  │
│   │  (Browser)      │  PORT 3010–    │  PORT 3010–3015  │  │
│   └─────────────────┘    3015        └────────┬─────────┘  │
│                                               │ USB / Win   │
│                                               ▼             │
│                                     ┌──────────────────┐    │
│                                     │  Thermal Printer │    │
│                                     │  (USB or Windows)│    │
│                                     └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

- UniPrint listens **only** on `127.0.0.1` — it is never reachable from the network
- All requests must come from a **whitelisted origin** and carry a **Bearer API key**
- The server automatically selects the first available port in the range **3010–3015**
- Your POS frontend must discover the active port at startup (see [Port Discovery](#port-discovery--fallback))

---

## Requirements

| Requirement | Version |
|---|---|
| Windows | 10 or 11 (x64) |
| Node.js *(dev only)* | 18+ |
| Thermal printer | USB direct-connected **or** installed via Windows print drivers |

---

## Installation

### Option A — Installer (Recommended)

1. Download `UniPrint-Setup-x.x.x.exe` from the [Releases](../../releases) page
2. Run the installer and follow the prompts
3. UniPrint starts automatically after installation and on every Windows login
4. A tray icon appears in the system notification area — closing the window **hides to tray**; right-click the tray icon to **Quit**

### Option B — Build from Source

```bash
git clone https://github.com/UniPrint-POS/uniprint-releases.git
cd uniprint-releases
npm install
npm run rebuild       # rebuilds the native USB module against Electron
npm start             # development mode
```

To produce a distributable installer:

```bash
npm run build:win
# Output: dist/UniPrint-Setup-x.x.x.exe
```

---

## First-Time Setup

Open UniPrint and complete the following four steps.

### Step 1 — Select a Printer

1. Click **Printers** in the sidebar
2. Click **Refresh** to scan for connected printers
3. Click **Select** next to your thermal printer

UniPrint detects:
- **USB** printers — devices connected directly via USB cable that match known thermal-printer Vendor IDs
- **Windows** printers — any printer installed in Windows Print Management, including network printers shared via a local driver

### Step 2 — Set an API Key

1. Click **API Key** in the sidebar
2. Enter a secret key *(minimum 16 characters)* in the input field and click **Set Key**
3. You will be prompted to **create an account PIN** — this single PIN protects both the API Key and the Whitelist. You will need it to view stored values. The PIN cannot be changed; to reset it, delete both the API key and all whitelist entries
4. Store your API key securely — you will need to add it to your POS application

**API Key requirements:**
- Minimum 16 characters; 32+ recommended
- Any characters allowed (letters, digits, symbols, spaces — leading/trailing spaces are trimmed)
- Stored as a SHA-256 hash; the plaintext is never written to disk
- Encrypted at rest with AES-256-GCM using a PBKDF2-derived key (200,000 iterations) from your account PIN; can be revealed at any time using your PIN

### Step 3 — Whitelist Your Domain

1. Click **Whitelist** in the sidebar
2. Enter your account PIN to unlock
3. Enter your POS application's origin — e.g. `yourapp.com` or `https://yourapp.com`
   - If you type a bare domain like `yourapp.com`, `https://` is prepended automatically
   - If your site uses plain HTTP, type `http://yourapp.com` — it is preserved as-is
4. Click **Add**; repeat for any additional origins (e.g. `http://localhost:3000` for local development)

Only requests whose `Origin` header exactly matches a whitelisted entry will be accepted.

### Step 4 — Note the Active Port

On the **Dashboard**, the **Server** stat card shows the port UniPrint is currently listening on (e.g. `Port 3010`). Your POS integration discovers this port dynamically — see the next section.

---

## Port Discovery & Fallback

UniPrint tries to bind to the following ports **in order**, stopping at the first available one:

```
3010 → 3011 → 3012 → 3013 → 3014 → 3015
```

This happens silently and automatically on every launch. If port `3010` is already occupied by another process, UniPrint binds to `3011`, and so on. If all six ports are in use, UniPrint logs an error and does not start.

**Your POS frontend must implement the same port-discovery logic.** On initialization, walk the same range, probe each port with a short timeout, and cache the result for the session.

### JavaScript — Browser (Recommended)

```js
// uniprint-client.js

const UNIPRINT_PORTS   = [3010, 3011, 3012, 3013, 3014, 3015];
const PROBE_TIMEOUT_MS = 600;

let _activePort = null;

/**
 * Discovers the port UniPrint is currently listening on.
 * Tries 3010 → 3011 → … → 3015 in order.
 * Returns the active port number, or null if UniPrint is not running.
 */
export async function discoverUniPrintPort(apiKey) {
  for (const port of UNIPRINT_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (res.ok) {
        _activePort = port;
        console.info(`[UniPrint] Connected on port ${port}`);
        return port;
      }
    } catch {
      // port not available — try next
    }
  }
  console.warn('[UniPrint] Not reachable on ports 3010–3015');
  return null;
}

/** Returns the cached port, re-discovering if not yet known. */
export async function getPort(apiKey) {
  if (_activePort !== null) return _activePort;
  return discoverUniPrintPort(apiKey);
}

/**
 * Resets the cached port.
 * Call this whenever a request returns a network error so the next
 * call re-discovers the port (UniPrint may have restarted on a different one).
 */
export function resetPort() {
  _activePort = null;
}
```

### Node.js — Backend

If your backend (running on the **same Windows PC** as UniPrint) manages print jobs:

```js
// uniprint-backend.js

const UNIPRINT_PORTS = [3010, 3011, 3012, 3013, 3014, 3015];
let _cachedPort = null;

async function discoverPort(apiKey) {
  for (const port of UNIPRINT_PORTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 600);
      const res = await fetch(`http://127.0.0.1:${port}/status`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) { _cachedPort = port; return port; }
    } catch {}
  }
  return null;
}

async function getPort(apiKey) {
  if (_cachedPort) return _cachedPort;
  return discoverPort(apiKey);
}

module.exports = { discoverPort, getPort, resetPort: () => { _cachedPort = null; } };
```

> **Note:** `127.0.0.1` is a loopback address — only processes on the **same machine** can reach UniPrint. If your backend runs on a different server, use the browser-side approach instead.

> **Re-discover after errors.** Always call `resetPort()` and retry if a request fails with a network-level error. UniPrint may have restarted and re-bound to a different port in the range.

---

## API Reference

All endpoints are served at `http://127.0.0.1:{PORT}`.

### Authentication

Every endpoint except `POST /pair` requires a Bearer token:

```
Authorization: Bearer YOUR_API_KEY
```

Missing or incorrect tokens receive `401 Unauthorized`.

### Rate Limiting

| Window | Max requests | Scope |
|---|---|---|
| 5 seconds | 10 requests | Per origin |

Exceeding the limit returns `429 Too Many Requests` with a `retryAfter` field (seconds).

---

### `GET /status`

Returns the current server and printer state. Use this to confirm UniPrint is reachable and to probe for the active port.

**Request**

```http
GET /status HTTP/1.1
Authorization: Bearer YOUR_API_KEY
Origin: https://yourapp.com
```

**Response `200 OK`**

```json
{
  "status":      "running",
  "version":     "1.0.1",
  "printer":     "connected",
  "printerName": "EPSON TM-T88VI",
  "queue":       0
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `string` | Always `"running"` |
| `version` | `string` | UniPrint version |
| `printer` | `string` | `"connected"` or `"disconnected"` |
| `printerName` | `string \| null` | Name of the active printer |
| `queue` | `number` | Number of jobs currently pending |

---

### `POST /print`

Enqueues a print job. The job is processed asynchronously; the response confirms acceptance, not completion. Subscribe to [WebSocket events](#websocket-integration) for completion notifications.

**Request**

```http
POST /print HTTP/1.1
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
Origin: https://yourapp.com
```

```json
{
  "template": "receipt",
  "data": { ... }
}
```

**Response `202 Accepted`**

```json
{
  "status":      "accepted",
  "jobId":       "3f2a1b4c-8d5e-4a2f-b1c0-9e7f6a3d2b1a",
  "queueLength": 1
}
```

**Response `400 Bad Request`** — validation failed

```json
{
  "errors": [
    { "msg": "items must be an array with 1-200 entries", "path": "data.items" }
  ]
}
```

**Response `503 Service Unavailable`** — print queue full (> 100 pending jobs)

---

### `GET /printers`

Returns all detected printers.

**Response `200 OK`**

```json
{
  "printers": [
    { "type": "usb",     "name": "USB Printer 04B8:0202", "vid": 1208, "pid": 514,  "portName": null     },
    { "type": "windows", "name": "EPSON TM-T88VI",        "vid": null, "pid": null, "portName": "USB001" }
  ]
}
```

---

### `POST /pair`

Requests pairing approval from the UniPrint user via a native dialog. Does **not** require authentication — intended for first-time setup flows.

**Request body**

```json
{ "name": "My POS System" }
```

**Responses**

| Status | Body | Meaning |
|---|---|---|
| `200` | `{"status":"already_paired"}` | Origin already whitelisted |
| `200` | `{"status":"approved"}` | User clicked Allow |
| `403` | `{"status":"denied","error":"..."}` | User clicked Deny |
| `429` | `{"error":"Pairing cooldown active","retryAfter":N}` | Try again in N seconds |

---

## Integrating with Your POS Website

### Where to Keep the API Key

**Browser (recommended for same-machine setups)**

Store the API key in your frontend's runtime memory or in `localStorage`. Because UniPrint only accepts connections from `127.0.0.1`, the key is never transmitted over any network.

```js
// Set once (e.g. from a settings screen)
localStorage.setItem('uniprint_key', 'your-api-key-here');

// Read at runtime
const API_KEY = localStorage.getItem('uniprint_key');
```

**Backend (Node.js running on the same PC)**

Store the key in an environment variable and read it at runtime. Keep it out of source control.

```bash
# .env
UNIPRINT_API_KEY=your-api-key-here
```

```js
const API_KEY = process.env.UNIPRINT_API_KEY;
```

> Never hard-code the API key in committed source files.

---

### Complete Drop-In Integration Module

```js
// uniprint.js

const PORTS = [3010, 3011, 3012, 3013, 3014, 3015];
let _port   = null;

async function _probe(port, key) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(600),
    });
    return r.ok;
  } catch { return false; }
}

/**
 * Walks ports 3010–3015 until one responds.
 * Call once at app startup, or after a connection error.
 */
export async function connect(apiKey) {
  for (const p of PORTS) {
    if (await _probe(p, apiKey)) { _port = p; return p; }
  }
  throw new Error('UniPrint is not running or is unreachable on ports 3010–3015.');
}

/**
 * Sends a print job. Automatically re-discovers the port once on connection error.
 *
 * @param {string}  apiKey    Your UniPrint API key
 * @param {string}  template  'receipt' | 'label' | 'test'
 * @param {object}  data      Template-specific payload (see Print Templates)
 * @returns {Promise<{status, jobId, queueLength}>}
 */
export async function print(apiKey, template, data) {
  if (!_port) await connect(apiKey);

  const doRequest = (port) => fetch(`http://127.0.0.1:${port}/print`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${apiKey}`,
      Origin:         location.origin,
    },
    body: JSON.stringify({ template, data }),
  });

  let res = await doRequest(_port).catch(() => null);

  if (!res || !res.ok) {
    // UniPrint may have restarted on a different port — re-discover once
    _port = null;
    await connect(apiKey);
    res  = await doRequest(_port);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`UniPrint error ${res.status}: ${body.error || 'unknown'}`);
  }
  return res.json();
}
```

**Usage:**

```js
import { connect, print } from './uniprint.js';

const API_KEY = localStorage.getItem('uniprint_key');

// On app startup — cache the active port
await connect(API_KEY);

// On order completion — send the receipt
const result = await print(API_KEY, 'receipt', {
  storeName:     'Daxtop Market',
  storeAddress:  '123 Main Street, Yerevan',
  storePhone:    '+374 10 000000',
  cashier:       'Anna',
  receiptNumber: 'ORD-00142',
  timestamp:     new Date().toISOString(),
  items: [
    { name: 'Coffee',   qty: 2, unitPrice: 1500 },
    { name: 'Sandwich', qty: 1, unitPrice: 2800 },
  ],
  subtotal: 5800,
  tax:       580,
  total:    6380,
  payment:  'Cash',
  received: 10000,
  change:    3620,
  footer:   'Thank you for your visit!',
});

console.log(`Job accepted: ${result.jobId}`);
```

---

## Print Templates

### `receipt` — Sales Receipt

| Field | Type | Required | Max |
|---|---|---|---|
| `data.items` | `Array` | ✓ | 200 items |
| `data.items[].name` | `string` | ✓ | — |
| `data.items[].qty` | `number` | ✓ | — |
| `data.items[].unitPrice` | `number` | ✓ | — |
| `data.total` | `number` | ✓ | — |
| `data.storeName` | `string` | | 128 chars |
| `data.storeAddress` | `string` | | 256 chars |
| `data.storePhone` | `string` | | 64 chars |
| `data.cashier` | `string` | | 64 chars |
| `data.receiptNumber` | `string` | | 64 chars |
| `data.timestamp` | `string` | | ISO 8601 |
| `data.subtotal` | `number` | | — |
| `data.discount` | `number` | | — |
| `data.tax` | `number` | | — |
| `data.payment` | `string` | | 32 chars |
| `data.received` | `number` | | — |
| `data.change` | `number` | | — |
| `data.notes` | `string` | | 512 chars |
| `data.footer` | `string` | | 256 chars |

### `label` — Product Label

| Field | Type | Max |
|---|---|---|
| `data.title` | `string` | 128 chars |
| `data.subtitle` | `string` | 128 chars |
| `data.price` | `string` | 32 chars |
| `data.barcode` | `string` | 48 chars |
| `data.lines` | `Array<string>` | 20 items × 256 chars |

### `test` — Test Print

No `data` fields required. Verifies the printer is connected and operational.

```json
{ "template": "test", "data": {} }
```

---

## WebSocket Integration

UniPrint exposes a WebSocket server on the **same port** as the HTTP server, allowing your POS to receive real-time job and printer events without polling.

### Connection

```
ws://127.0.0.1:{PORT}
```

The upgrade request must include a whitelisted `Origin` header. The connection must **authenticate within 5 seconds** or it is terminated automatically.

### Authentication Handshake

Immediately after the WebSocket connection is open, send:

```json
{ "event": "auth", "token": "YOUR_API_KEY" }
```

Success:

```json
{ "event": "auth", "status": "ok" }
```

Failure (connection is closed after this):

```json
{ "event": "auth", "status": "error", "error": "Invalid token" }
```

### Server-Sent Events

| Event | Payload | Frequency |
|---|---|---|
| `status` | `{ printer, printerName, queue }` | Every 5 seconds automatically |
| `job:enqueued` | `{ id, queueLength }` | On each new job |
| `job:processing` | `{ id }` | When a job begins printing |
| `job:done` | `{ id }` | When a job prints successfully |
| `job:failed` | `{ id, error, attempt }` | On failure (up to 3 retries) |

### Keepalive

Send a ping every ~30 seconds to keep the connection alive. UniPrint replies with `pong`. Limit: **10 pings per 60-second window**.

```json
{ "event": "ping" }
```

### Full WebSocket Example

```js
// uniprint-ws.js

const PORTS = [3010, 3011, 3012, 3013, 3014, 3015];

export function connectWebSocket(apiKey, handlers = {}) {
  let ws        = null;
  let port      = null;
  let pingTimer  = null;
  let retryTimer = null;
  let stopped   = false;

  async function tryConnect() {
    // Walk port range to find the active one
    for (const p of PORTS) {
      try {
        await new Promise((resolve, reject) => {
          const sock = new WebSocket(`ws://127.0.0.1:${p}`);
          sock.onopen  = () => { ws = sock; port = p; resolve(); };
          sock.onerror = reject;
          setTimeout(reject, 800);
        });
        break;
      } catch { ws = null; }
    }

    if (!ws) { scheduleRetry(); return; }

    ws.onmessage = ({ data }) => {
      let msg; try { msg = JSON.parse(data); } catch { return; }
      if (msg.event === 'auth' && msg.status === 'ok') {
        pingTimer = setInterval(() => ws?.send(JSON.stringify({ event: 'ping' })), 30000);
        handlers.onConnected?.();
      } else {
        handlers.onEvent?.(msg);
        if (msg.event === 'status')     handlers.onStatus?.(msg);
        if (msg.event === 'job:done')   handlers.onJobDone?.(msg);
        if (msg.event === 'job:failed') handlers.onJobFailed?.(msg);
      }
    };

    ws.onclose = () => {
      clearInterval(pingTimer);
      handlers.onDisconnected?.();
      if (!stopped) scheduleRetry();
    };

    ws.send(JSON.stringify({ event: 'auth', token: apiKey }));
  }

  function scheduleRetry() {
    retryTimer = setTimeout(tryConnect, 5000);
  }

  tryConnect();

  return {
    disconnect() {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      ws?.close();
    },
  };
}
```

**Usage:**

```js
import { connectWebSocket } from './uniprint-ws.js';

const ws = connectWebSocket(localStorage.getItem('uniprint_key'), {
  onConnected:    ()    => console.log('UniPrint online'),
  onDisconnected: ()    => console.log('UniPrint offline'),
  onStatus:       (msg) => updatePrinterIndicator(msg.printer === 'connected'),
  onJobDone:      (msg) => console.log(`Printed job ${msg.id}`),
  onJobFailed:    (msg) => alert(`Print failed: ${msg.error}`),
});

// On page teardown
ws.disconnect();
```

---

## Security Model

| Layer | Implementation |
|---|---|
| Network isolation | Server binds exclusively to `127.0.0.1`; unreachable from LAN or internet |
| Origin enforcement | CORS middleware rejects every request from a non-whitelisted origin before auth is evaluated |
| Authentication | Bearer token verified via SHA-256 hash using `timingSafeEqual` (timing-attack resistant) |
| Brute-force prevention | Rate limiter runs **before** auth — 10 req/5 s per origin caps guessing attempts |
| Request validation | JSON body capped at 50 KB; all print fields validated by `express-validator` |
| HTTP hardening | `helmet` sets `X-Frame-Options`, `X-Content-Type-Options`, HSTS, and other security headers |
| API key at rest | Stored as SHA-256 hash — plaintext never written to disk |
| API key reveal | Encrypted with AES-256-GCM; key derived via PBKDF2 (200,000 iterations, SHA-256, 32-byte key) from account PIN |
| Account PIN | Stored as a PBKDF2 hash with a random 32-byte salt; cannot be changed — reset only by deleting all protected data |
| WebSocket | 5 s auth timeout; immediate termination on bad token; 10 ping/min per client; 4 KB max message |
| Config storage | `electron-store` writes to `%APPDATA%\uniprint\config.json` — fully isolated per Windows user account |
| Single instance | `app.requestSingleInstanceLock()` prevents duplicate servers running on the same port range |

---

## Building from Source

```bash
npm install

# Rebuild the native USB module for the installed Electron version
npm run rebuild

# Run in development mode (DevTools enabled, auto-updater skipped)
npm run dev

# Produce a Windows installer
npm run build:win
# → dist/UniPrint-Setup-x.x.x.exe

# Build and publish a GitHub release (requires GH_TOKEN)
npm run build:publish
```

### Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | No | Set to `development` to enable DevTools and skip the auto-updater |
| `GH_TOKEN` | Build/publish only | GitHub personal access token for `build:publish` |

No runtime environment variables are needed for normal use. All configuration is persisted in `%APPDATA%\uniprint\config.json`.

---

## Troubleshooting

### "Could not reach UniPrint on any port"

- Confirm UniPrint is running — look for its icon in the Windows system tray
- Confirm your domain is listed in the UniPrint **Whitelist**
- Check that no firewall rule is blocking `127.0.0.1` loopback connections

### Printer shows "Offline" / "Disconnected"

- Click **Reconnect Printer** on the Dashboard
- Go to **Printers → Refresh** and re-select your printer
- Unplug and re-plug the USB cable — UniPrint detects hotplug events automatically

### Prints not coming out / queue stuck

- Verify the correct printer is selected in **Printers**
- Check the **Logs** tab for `ERROR` entries related to print jobs
- Confirm the printer is powered on, has paper, and is not in an error state

### "Origin not authorized" (403)

- Add your site's exact origin to the Whitelist — `https://yourapp.com` with no trailing slash or path
- For local development, add `http://localhost:PORT` as a separate entry

### "Invalid API key" (401)

- Confirm the key in your POS matches exactly what was entered in UniPrint (it is trimmed of leading/trailing spaces)

### App exits immediately on `npm start`

UniPrint enforces a single instance. If a second launch exits instantly, the app is already running in the system tray. Right-click the tray icon → **Show** to bring the window back.

---

## License

Copyright © 2026 UniPrint. All rights reserved.
