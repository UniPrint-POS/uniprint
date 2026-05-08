# UniPrint — Product Documentation

**Version 1.0.1**  
*Local Thermal Printer Bridge for Web-Based POS Systems*

---

## Overview

UniPrint is a production-grade Electron desktop application that runs on the cashier's Windows PC and exposes a secure local HTTP API on `127.0.0.1`. It acts as a silent bridge between any web-based POS system and USB or Windows thermal printers, eliminating the need for cloud print services, proprietary SDKs, or manual driver configuration.

Once installed and configured, printing is fully automatic — a single API call from the browser triggers the entire chain from receipt data to paper output.

---

## Contents

1. [Architecture](#1-architecture)
2. [Installation & Distribution](#2-installation--distribution)
3. [Configuration Reference](#3-configuration-reference)
4. [Security Architecture](#4-security-architecture)
5. [HTTP API Specification](#5-http-api-specification)
6. [WebSocket Protocol](#6-websocket-protocol)
7. [Port Fallback System](#7-port-fallback-system)
8. [Print Template Reference](#8-print-template-reference)
9. [POS Integration Guide](#9-pos-integration-guide)
10. [Auto-Update System](#10-auto-update-system)
11. [Data Storage & Privacy](#11-data-storage--privacy)
12. [Technical Specifications](#12-technical-specifications)

---

## 1. Architecture

### System Diagram

```
╔══════════════════════════════════════════════════════════════╗
║                      Windows Workstation                     ║
║                                                              ║
║  ┌───────────────────────────────────────────────────────┐   ║
║  │                     UniPrint                          │   ║
║  │                                                       │   ║
║  │  ┌─────────────────┐    ┌──────────────────────────┐  │   ║
║  │  │  Electron Shell  │    │     Express HTTP Server  │  │   ║
║  │  │  (Renderer UI)  │◄──►│     127.0.0.1:3010–3015  │  │   ║
║  │  └─────────────────┘    └──────────────┬───────────┘  │   ║
║  │                                        │               │   ║
║  │  ┌─────────────────┐    ┌──────────────▼───────────┐  │   ║
║  │  │  electron-store  │    │      PrinterManager      │  │   ║
║  │  │  (config.json)  │    │   USB / Windows Driver   │  │   ║
║  │  └─────────────────┘    └──────────────┬───────────┘  │   ║
║  └───────────────────────────────────────┼───────────────┘   ║
║                                          │                    ║
║                               ┌──────────▼──────────┐        ║
║                               │   Thermal Printer   │        ║
║                               │   (USB or Windows)  │        ║
║                               └─────────────────────┘        ║
╚══════════════════════════════════════════════════════════════╝
         ▲ HTTP/WebSocket on 127.0.0.1
         │
╔════════╧═════════════╗
║  POS Web Application  ║
║  (Browser on same PC) ║
╚══════════════════════╝
```

### Component Summary

| Component | Technology | Purpose |
|---|---|---|
| Desktop shell | Electron 33 | Window management, system tray, IPC, auto-update |
| Local HTTP server | Express 4 + Node `http` | REST API for print jobs, printer info, status |
| WebSocket server | `ws` 8 | Real-time push events for job and printer status |
| Printer driver | Native `usb` module + Windows PowerShell | USB ESC/POS and Windows GDI printing |
| Print queue | Custom `EventEmitter` queue | Job ordering, retry logic, backpressure |
| Config store | `electron-store` (JSON + schema) | Persistent settings with validation |
| Logger | `winston` + daily rotation | Structured log files with automatic cleanup |
| Auth | SHA-256 hash + `timingSafeEqual` | Timing-attack-resistant API key verification |
| Encryption | AES-256-GCM + PBKDF2 | API key encrypted at rest for user-initiated reveal |

---

## 2. Installation & Distribution

### Installer

UniPrint ships as a standard NSIS installer for Windows x64:

```
UniPrint-Setup-1.0.1.exe
```

The installer:
- Creates a Start Menu shortcut
- Creates a Desktop shortcut (optional)
- Registers UniPrint as a Windows Login startup item (optional, configurable in-app)
- Launches UniPrint on completion

### Tray Behaviour

- Closing the UniPrint window **hides it to the system tray** — the server continues running
- Right-clicking the tray icon provides **Show** and **Quit** options
- `Quit` terminates the server and all connections cleanly

### Single-Instance Lock

`app.requestSingleInstanceLock()` ensures only one UniPrint instance runs at a time. If a second launch is attempted, the existing instance's window is focused and the new process exits immediately.

---

## 3. Configuration Reference

All configuration is persisted in:

```
%APPDATA%\uniprint\config.json
```

This path is **per Windows user account** — separate users on the same machine have completely isolated configurations.

| Key | Type | Default | Description |
|---|---|---|---|
| `paperWidth` | `58 \| 80` | `80` | Thermal paper width in mm |
| `autoStart` | `boolean` | `false` | Whether UniPrint launches on Windows login |
| `selectedPrinter` | `object \| null` | `null` | The currently selected printer config |
| `whitelist` | `string[]` | `[]` | Whitelisted CORS origins |
| `apiKeyHash` | `string` | `""` | SHA-256 hash of the API key (for authentication) |
| `apiKeyEncrypted` | `string` | `""` | AES-256-GCM encrypted API key (for user-initiated reveal) |
| `accountPinHash` | `string` | `""` | PBKDF2 hash of the account PIN |
| `accountPinSetPage` | `string` | `""` | Which page (`"API Key"` or `"Whitelist"`) first set the PIN |

Configuration is validated against a JSON schema on every read/write using `electron-store`.

---

## 4. Security Architecture

UniPrint applies defense-in-depth across every layer of the stack.

### Network Isolation

The HTTP server binds **exclusively to `127.0.0.1`**, the loopback address. It is architecturally impossible for any device on the local network, internet, or VPN to reach the UniPrint server — only processes running on the same Windows PC can connect.

### Origin Enforcement (CORS)

Every request (including WebSocket upgrades) must carry an `Origin` header matching a value in the stored whitelist. Requests without a matching origin are rejected with `403 Forbidden` **before** authentication is evaluated. This prevents:
- Cross-origin requests from malicious or unexpected web pages
- Requests from non-browser clients that cannot supply a valid `Origin`

### Authentication

The HTTP server requires a `Bearer` token on every endpoint except `POST /pair`. Authentication is implemented as:

1. The stored API key hash is read from disk (`apiKeyHash`)
2. A SHA-256 hash is computed from the provided token
3. Both hashes are compared using Node.js `crypto.timingSafeEqual()` — a constant-time comparison that prevents timing-based enumeration attacks

### Brute-Force Prevention

The rate limiter middleware is intentionally applied **before** the auth middleware in the middleware chain. This means failed authentication attempts consume rate-limit budget, capping the speed at which an attacker could guess the API key to **10 attempts per 5 seconds per origin**.

### API Key Storage

| Property | Mechanism |
|---|---|
| Authentication | SHA-256 hash only — the plaintext key is never written to disk |
| Reveal | AES-256-GCM encryption; key derived by PBKDF2 (200,000 iterations, SHA-256, 32-byte output) from the user's account PIN |
| PIN storage | PBKDF2-derived hash with a random 32-byte salt, stored as `{salt, hash}` JSON — the plaintext PIN is never stored |

### Account PIN

- Set once; cannot be changed via the UI (only implicitly reset when all protected data is deleted)
- Protects both API Key reveal and Whitelist management
- Wrong PIN in the reveal flow → `null` returned; the AES-GCM auth tag ensures cryptographic verification

### WebSocket Security

| Control | Value |
|---|---|
| Auth timeout | 5 seconds — connection terminated if auth event not received |
| Max simultaneous clients | 10 authenticated connections |
| Max message size | 4 KB |
| Ping flood limit | 10 pings per 60-second window per client |
| Origin check | Same whitelist as HTTP — enforced at upgrade time |

### Request Validation

All `POST /print` bodies are validated with `express-validator` before reaching the queue:
- JSON body hard-capped at **50 KB**
- `template` field must be one of `receipt`, `label`, `test`
- All `receipt` and `label` fields have type checks and length limits
- `items` array bounded to 1–200 entries

---

## 5. HTTP API Specification

**Base URL:** `http://127.0.0.1:{PORT}`

### Common Headers

| Header | Value | Required on |
|---|---|---|
| `Authorization` | `Bearer YOUR_API_KEY` | All endpoints except `/pair` |
| `Content-Type` | `application/json` | `POST` requests |
| `Origin` | Your whitelisted origin | All requests |

### Error Format

```json
{ "error": "Human-readable error message" }
```

Validation errors return an array:

```json
{
  "errors": [
    { "msg": "...", "path": "data.items", "type": "field" }
  ]
}
```

---

### Endpoints

#### `GET /status`

Probe endpoint for port discovery and health checks.

```json
{
  "status":      "running",
  "version":     "1.0.1",
  "printer":     "connected",
  "printerName": "EPSON TM-T88VI",
  "queue":       2
}
```

#### `POST /print`

Submit a print job to the queue. Returns immediately; processing is asynchronous.

**Request body:**

```json
{
  "template": "receipt | label | test",
  "data": { ... }
}
```

**Response `202 Accepted`:**

```json
{
  "status":      "accepted",
  "jobId":       "uuid-v4",
  "queueLength": 3
}
```

#### `GET /printers`

List all detected USB and Windows printers.

```json
{
  "printers": [
    { "type": "usb",     "name": "USB Printer 04B8:0202", "vid": 1208, "pid": 514,  "portName": null     },
    { "type": "windows", "name": "EPSON TM-T88VI",        "vid": null, "pid": null, "portName": "USB001" }
  ]
}
```

#### `POST /pair`

Request user approval to whitelist an origin. No API key required. Subject to a **60-second per-origin cooldown** between requests.

```json
// Request
{ "name": "My POS App" }

// Response — approved
{ "status": "approved" }

// Response — already paired
{ "status": "already_paired" }

// Response — denied
{ "status": "denied", "error": "User denied pairing request" }
```

---

## 6. WebSocket Protocol

UniPrint shares the HTTP server port with a WebSocket server, allowing POS applications to receive real-time events.

### Connection Lifecycle

```
Client                          UniPrint
  │                                │
  │── WS Upgrade (Origin: ...) ──► │  (Origin check: reject if not whitelisted)
  │◄─ 101 Switching Protocols ─── │
  │                                │
  │── {"event":"auth","token":…} ─►│  (verify API key)
  │◄─ {"event":"auth","status":"ok"}│
  │                                │
  │◄─ {"event":"status",…} ──────── │  (every 5 s automatically)
  │◄─ {"event":"job:enqueued",…} ── │  (on new job)
  │◄─ {"event":"job:done",…} ─────── │  (on completion)
  │                                │
  │── {"event":"ping"} ───────────► │
  │◄─ {"event":"pong"} ──────────── │
```

### Event Reference

| Event (server → client) | Payload | Trigger |
|---|---|---|
| `auth` | `{status:"ok"}` or `{status:"error",error}` | Response to auth |
| `pong` | — | Response to `ping` |
| `status` | `{printer, printerName, queue}` | Every 5 seconds |
| `job:enqueued` | `{id, queueLength}` | Job added to queue |
| `job:processing` | `{id}` | Job started |
| `job:done` | `{id}` | Job completed |
| `job:failed` | `{id, error, attempt}` | Job failed (max 3 retries) |

---

## 7. Port Fallback System

### Server-Side (UniPrint)

On every launch, UniPrint attempts to bind sequentially to the following ports:

```
3010 → 3011 → 3012 → 3013 → 3014 → 3015
```

The binding logic:

```js
const FALLBACK_PORTS = [3010, 3011, 3012, 3013, 3014, 3015];

for (const port of FALLBACK_PORTS) {
  try {
    await tryListen(server, port);  // bind to 127.0.0.1:port
    break;                          // success — stop trying
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err; // unexpected error — rethrow
    // EADDRINUSE: port is taken — try the next one
  }
}
```

The active port is stored in memory and reported via IPC to the Electron renderer (shown in the Dashboard). If all six ports are occupied, UniPrint logs an error and does not start.

### Client-Side (Your POS Application)

Your POS must implement the same sequential probe logic. This is a one-time initialization step performed at application startup.

```js
const UNIPRINT_PORTS = [3010, 3011, 3012, 3013, 3014, 3015];

async function discoverUniPrintPort(apiKey) {
  for (const port of UNIPRINT_PORTS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(600), // 600ms probe timeout per port
      });
      if (response.ok) return port;
    } catch {
      // this port is not active — continue to next
    }
  }
  return null; // UniPrint is not running
}
```

**Important patterns:**

1. **Cache the port** — store the discovered port in memory for the session; do not re-discover on every request
2. **Re-discover on failure** — if a request fails with a network error, reset the cached port and re-run discovery; UniPrint may have restarted and bound to a different port
3. **Handle null gracefully** — if discovery returns `null`, show the user a clear message that UniPrint is not running rather than failing silently

---

## 8. Print Template Reference

### Template: `receipt`

Prints a full sales receipt. The `items` array is the only required field; all other fields are optional and will be omitted from the printed output if not provided.

**Minimal example:**

```json
{
  "template": "receipt",
  "data": {
    "items": [
      { "name": "Americano",  "qty": 1, "unitPrice": 1200 },
      { "name": "Croissant",  "qty": 2, "unitPrice": 800  }
    ],
    "total": 2800
  }
}
```

**Full example:**

```json
{
  "template": "receipt",
  "data": {
    "storeName":     "Daxtop Market",
    "storeAddress":  "123 Main Street, Yerevan, Armenia",
    "storePhone":    "+374 10 000000",
    "cashier":       "Anna Petrosyan",
    "receiptNumber": "ORD-00142",
    "timestamp":     "2026-05-01T14:23:00Z",
    "items": [
      { "name": "Coffee (Large)",  "qty": 2, "unitPrice": 1500 },
      { "name": "Club Sandwich",   "qty": 1, "unitPrice": 2800 },
      { "name": "Orange Juice",    "qty": 1, "unitPrice": 900  }
    ],
    "subtotal": 6700,
    "discount": 200,
    "tax":       650,
    "total":    7150,
    "payment":  "Card",
    "received": 7150,
    "change":      0,
    "notes":    "Customer loyalty discount applied",
    "footer":   "Thank you! Visit us again."
  }
}
```

### Template: `label`

Prints a product label, optionally including a barcode.

```json
{
  "template": "label",
  "data": {
    "title":    "Organic Green Tea",
    "subtitle": "Premium Blend",
    "price":    "1,200 AMD",
    "barcode":  "4780201234567",
    "lines":    ["Net weight: 100g", "Best before: 2026-01-01"]
  }
}
```

### Template: `test`

Prints a test page to confirm the printer is connected and the integration is working.

```json
{ "template": "test", "data": {} }
```

---

## 9. POS Integration Guide

### Overview

The recommended integration pattern is:

```
1. App starts → discover active UniPrint port (3010–3015)
2. Store port in session memory
3. On each print action → POST /print with Bearer token
4. On network error → reset port, re-discover, retry once
5. (Optional) Open WebSocket → receive real-time job status
```

### Step 1: Store the API Key

The API key must be available to your frontend. Recommended approach:

| Context | Storage Location |
|---|---|
| Single-machine POS (browser on same PC) | `localStorage` or in-memory after first-run setup |
| Multi-register (backend orchestration) | Environment variable on the register's local Node.js process |

```js
// First-time setup (show once, store result)
const key = prompt('Paste the API key from UniPrint settings:');
localStorage.setItem('uniprint_api_key', key);
```

```js
// Runtime read
const API_KEY = localStorage.getItem('uniprint_api_key');
if (!API_KEY) { /* prompt user to set it up */ }
```

### Step 2: Discover the Port at Startup

```js
// uniprint.js — include this file in your POS project

const PORTS = [3010, 3011, 3012, 3013, 3014, 3015];
let _port   = null;

export async function connect(apiKey) {
  for (const p of PORTS) {
    try {
      const ok = await fetch(`http://127.0.0.1:${p}/status`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(600),
      }).then(r => r.ok).catch(() => false);
      if (ok) { _port = p; return p; }
    } catch {}
  }
  throw new Error('UniPrint not found. Please ensure the application is running.');
}

export async function print(apiKey, template, data) {
  if (!_port) await connect(apiKey);

  const send = (port) => fetch(`http://127.0.0.1:${port}/print`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, Origin: location.origin },
    body:    JSON.stringify({ template, data }),
  });

  let res = await send(_port).catch(() => null);

  if (!res || !res.ok) {
    _port = null;           // force re-discovery
    await connect(apiKey);
    res  = await send(_port);
  }

  if (!res.ok) throw new Error(`Print error: HTTP ${res.status}`);
  return res.json();
}
```

### Step 3: Call Print on Order Completion

```js
import { connect, print } from './uniprint.js';

const API_KEY = localStorage.getItem('uniprint_api_key');

// Initialize on app load
await connect(API_KEY);

// Trigger on order placed / payment confirmed
async function onOrderComplete(order) {
  try {
    const result = await print(API_KEY, 'receipt', {
      storeName:     order.store.name,
      cashier:       order.cashier,
      receiptNumber: order.id,
      timestamp:     order.timestamp,
      items:         order.items.map(i => ({
        name:      i.productName,
        qty:       i.quantity,
        unitPrice: i.price,
      })),
      subtotal: order.subtotal,
      tax:      order.tax,
      total:    order.total,
      payment:  order.paymentMethod,
      received: order.amountReceived,
      change:   order.change,
      footer:   'Thank you for your purchase!',
    });
    console.log(`Receipt printed (job ${result.jobId})`);
  } catch (err) {
    console.error('Print failed:', err.message);
    showPrintErrorModal();
  }
}
```

### Step 4: Handle Printer Status with WebSocket

```js
import { connectWebSocket } from './uniprint-ws.js';

let printerOnline = false;

const ws = connectWebSocket(API_KEY, {
  onConnected:    ()    => { printerOnline = true;  updateStatusUI('online');  },
  onDisconnected: ()    => { printerOnline = false; updateStatusUI('offline'); },
  onStatus:       (msg) => { printerOnline = msg.printer === 'connected'; updateStatusUI(msg.printer); },
  onJobDone:      (msg) => showSuccessToast(`Receipt printed`),
  onJobFailed:    (msg) => showErrorToast(`Printing failed: ${msg.error}`),
});
```

---

## 10. Auto-Update System

UniPrint uses `electron-updater` with GitHub Releases as the distribution channel.

| Feature | Behaviour |
|---|---|
| Auto-check on launch | Checks for updates 30 seconds after startup |
| Periodic check | Checks every 4 hours while the app is running |
| Auto-download | Downloads available updates automatically in the background |
| Install on quit | Installs downloaded updates when the app next quits (configurable) |
| Manual check | **Updates → Check for Updates** button; shows "You are running the latest version." within ~12 seconds if no update is found |
| Install now | When a download completes, **Install & Restart** button appears |
| Verification | Update packages are verified against SHA-512 checksums in `latest.yml` before installation |

---

## 11. Data Storage & Privacy

All data is stored **exclusively on the local machine** of the user who installed UniPrint.

| Data | Location | Cleared by |
|---|---|---|
| API key hash | `%APPDATA%\uniprint\config.json` | **Delete API Key** button |
| API key (encrypted) | `%APPDATA%\uniprint\config.json` | **Delete API Key** button |
| Whitelist | `%APPDATA%\uniprint\config.json` | **Delete All** button or removing individually |
| Account PIN hash | `%APPDATA%\uniprint\config.json` | Auto-cleared when both API key and whitelist are empty |
| Application logs | `%APPDATA%\uniprint\logs\` | Daily rotation; old files deleted automatically |
| Temporary print files | `%TEMP%\uniprint-*.prn` | Deleted on each app launch |

No data is ever sent to any remote server by UniPrint itself. The auto-update check contacts GitHub's release API to compare version numbers only.

---

## 12. Technical Specifications

| Property | Value |
|---|---|
| Platform | Windows 10 / 11, x64 |
| Runtime | Electron 33, Node.js (bundled) |
| Server | Express 4, bound to `127.0.0.1` only |
| Ports | `3010–3015` (first available, sequential fallback) |
| WebSocket | `ws` library, same port as HTTP |
| Max request body | 50 KB |
| Print queue depth | 100 jobs max |
| Job retry | Up to 3 attempts with 1 s / 2 s / 4 s back-off |
| Rate limit | 10 requests / 5 seconds / origin |
| WS clients | 10 simultaneous authenticated connections |
| Log rotation | Daily, kept for 14 days, max 20 MB per file |
| Config validation | JSON Schema via `electron-store` |
| API key hashing | SHA-256 (`crypto` built-in) |
| API key encryption | AES-256-GCM, PBKDF2 key derivation (200,000 iterations, SHA-256) |
| PIN hashing | PBKDF2 (200,000 iterations, SHA-256, 32-byte output, 32-byte random salt) |
| Comparison | `timingSafeEqual` for all secret comparisons |
| Config isolation | Per Windows user account (`%APPDATA%`) |
| Installer format | NSIS (Windows x64) |
| Update provider | GitHub Releases (`electron-updater`) |

---

*UniPrint — Copyright © 2026. All rights reserved.*
