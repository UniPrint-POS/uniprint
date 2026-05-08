# UniPrint

**Universal local USB thermal printer bridge for web-based POS systems.**

UniPrint runs silently on the cashier's PC and exposes a secure local HTTP API on `127.0.0.1`. Any authorized web application can send structured print jobs to it — receipts, labels, or test pages — without ever touching USB drivers, raw ESC/POS commands, or printer configuration.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Initial Setup](#initial-setup)
  - [1. Select a Printer](#1-select-a-printer)
  - [2. Set an API Key](#2-set-an-api-key)
  - [3. Add Domains to the Whitelist](#3-add-domains-to-the-whitelist)
- [Integrating Your Web App](#integrating-your-web-app)
  - [Discover the Port](#discover-the-port)
  - [Authentication](#authentication)
  - [Endpoints](#endpoints)
  - [POST /print — Receipt](#post-print--receipt)
  - [POST /print — Label](#post-print--label)
  - [POST /print — Test Page](#post-print--test-page)
  - [GET /status](#get-status)
  - [GET /printers](#get-printers)
  - [POST /pair — Automatic Pairing](#post-pair--automatic-pairing)
  - [WebSocket](#websocket)
- [Security Model](#security-model)
- [Rate Limiting](#rate-limiting)
- [Troubleshooting](#troubleshooting)
- [Building from Source](#building-from-source)

---

## How It Works

```
Your Web App (browser)
        │
        │  POST /print  { template, data }
        │  Authorization: Bearer <api-key>
        │  Origin: https://yourapp.com
        ▼
┌─────────────────────────────────┐
│  UniPrint  (127.0.0.1:3010)    │
│                                 │
│  1. Validate origin whitelist   │
│  2. Validate API key (SHA-256)  │
│  3. Rate limit per origin       │
│  4. Validate print schema       │
│  5. Enqueue job                 │
│  6. Generate ESC/POS buffer     │
│  7. Send to USB printer         │
└─────────────────────────────────┘
        │
        │  Raw ESC/POS via USB
        ▼
  Thermal Printer
```

UniPrint:

- Binds **exclusively** to `127.0.0.1` — never reachable from the network.
- Accepts only origins you explicitly whitelist.
- Validates every API key against a stored SHA-256 hash — the original key is never saved.
- Converts structured JSON templates into ESC/POS commands so your website never sends raw printer data.
- Falls back across ports `3010`–`3015` if any are occupied.

---

## Requirements

| Component | Minimum |
|-----------|---------|
| OS | Windows 10 or Windows 11 (64-bit) |
| Runtime | Bundled — no separate install needed |
| Printer | Any USB ESC/POS thermal printer (receipt or label) |
| Browser | Any modern browser on the same PC |

---

## Installation

1. Download the latest `UniPrint-Setup-x.x.x.exe` from the Releases page.
2. Run the installer. Choose your installation directory when prompted.
3. UniPrint starts automatically after installation and minimizes to the system tray.
4. On subsequent logins, enable **Auto-start** in the Settings tab if you want it to launch with Windows.

To open the main window at any time, **double-click the UniPrint tray icon**.

---

## Initial Setup

Complete these three steps before your web app can print. All settings persist across restarts.

### 1. Select a Printer

1. Open UniPrint and go to the **Printers** tab.
2. Click **Refresh** to scan for connected USB and Windows printers.
3. Click **Select** next to your thermal printer.
4. UniPrint connects immediately. The **Dashboard** status changes to **Connected**.

> If your printer does not appear, ensure it is plugged in and powered on, then click Refresh again. UniPrint also detects printer hot-plug automatically — you do not need to restart the app after reconnecting a cable.

### 2. Set an API Key

The API key is a shared secret between UniPrint and your web application. UniPrint stores only a SHA-256 hash of it — the plaintext key is never written to disk.

1. Go to the **API Key** tab.
2. Enter any secret string of **at least 16 characters**. Use a strong, randomly generated value in production.
3. Click **Set Key**. The status indicator turns green.
4. Copy the same key into your web application's backend configuration. Your server will include it in every print request header.

> To rotate the key, click **Clear API Key**, then set a new one. Update your web app configuration to match.

**Generate a strong key (examples):**

```bash
# Linux / macOS
openssl rand -hex 32

# PowerShell (Windows)
[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()

# Node.js
require('crypto').randomBytes(32).toString('hex')
```

### 3. Add Domains to the Whitelist

UniPrint rejects all requests from domains not on the whitelist. The list is empty by default.

1. Go to the **Whitelist** tab.
2. Enter the full origin of your web application — **protocol + hostname + port if non-standard**.
3. Click **Add**.

**Examples of valid origins:**

| Your app URL | Origin to add |
|---|---|
| `https://pos.mystore.com` | `https://pos.mystore.com` |
| `https://myapp.com/dashboard` | `https://myapp.com` |
| `http://localhost:3000` | `http://localhost:3000` |
| `http://192.168.1.10:8080` | `http://192.168.1.10:8080` |

> Add only origins you control. Each entry is an exact match — `https://mystore.com` and `https://www.mystore.com` are different origins and must be added separately if both are used.

To remove an entry, click the **×** button next to it.

---

## Integrating Your Web App

### Discover the Port

UniPrint tries ports `3010` through `3015` in order and uses the first available one. The active port is shown on the Dashboard.

Your web application should attempt each port until it gets a `200` response from `/status`:

```javascript
async function findUniPrint(apiKey, origin) {
  for (let port = 3010; port <= 3015; port++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) return port;
    } catch {}
  }
  return null;
}
```

Cache the discovered port for the session. Re-discover if a request fails with a network error.

---

### Authentication

Every request to `/print`, `/printers`, and `/status` must include:

```
Authorization: Bearer <your-api-key>
Origin: https://yourapp.com
```

Requests missing either header, or with an unrecognized origin, are rejected with `401` or `403`.

**Important:** Send the API key only from your **backend server** or from a trusted environment. Never expose it in client-side JavaScript that end users can inspect.

---

### Endpoints

| Method | Path | Auth required | Description |
|--------|------|:---:|-------------|
| `POST` | `/print` | Yes | Submit a print job |
| `GET` | `/printers` | Yes | List detected printers |
| `GET` | `/status` | Yes | Health check |
| `POST` | `/pair` | No | Request domain approval from the user |

All request and response bodies are `application/json`.

---

### POST /print — Receipt

Print a standard point-of-sale receipt.

**Request**

```http
POST http://127.0.0.1:3010/print
Authorization: Bearer <api-key>
Content-Type: application/json
Origin: https://yourapp.com
```

```json
{
  "template": "receipt",
  "data": {
    "storeName":     "My Store",
    "storeAddress":  "123 Main Street, City",
    "storePhone":    "+1 555 010 0100",
    "cashier":       "Jane",
    "receiptNumber": "00042",
    "timestamp":     "2025-06-15T14:30:00Z",
    "items": [
      { "name": "Espresso",    "qty": 2, "unitPrice": 3.50 },
      { "name": "Croissant",   "qty": 1, "unitPrice": 2.80 },
      { "name": "Orange Juice","qty": 1, "unitPrice": 4.20 }
    ],
    "subtotal": 14.00,
    "discount": 1.00,
    "tax":      1.17,
    "total":    14.17,
    "payment":  "Card",
    "received": 14.17,
    "change":   0.00,
    "notes":    "Member discount applied",
    "footer":   "Thank you for visiting!"
  }
}
```

**Required fields:** `data.items` (array, 1–200 entries with `name`, `qty`, `unitPrice`), `data.total`.

All other fields are optional. Omitted fields are simply not printed.

**Response `202 Accepted`**

```json
{
  "status": "accepted",
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "queueLength": 1
}
```

The job is queued immediately. Printing happens asynchronously. Use the [WebSocket](#websocket) to receive real-time job status events.

---

### POST /print — Label

Print a product or shipping label.

```json
{
  "template": "label",
  "data": {
    "title":    "Wireless Headphones",
    "subtitle": "SKU: WH-1000XM5",
    "price":    "349.99",
    "barcode":  "5901234123457",
    "lines": [
      "Color: Midnight Black",
      "Warranty: 24 months"
    ]
  }
}
```

All fields are optional. If `barcode` is provided, a Code 128 barcode is printed with the human-readable number below it.

---

### POST /print — Test Page

Verifies the printer is connected and responding.

```json
{
  "template": "test",
  "data": {}
}
```

The test page prints the current date/time, paper width, and a confirmation message.

---

### GET /status

Returns the current state of UniPrint.

**Response `200 OK`**

```json
{
  "status":      "running",
  "version":     "1.0.0",
  "printer":     "connected",
  "printerName": "EPSON TM-T88VI",
  "queue":       0
}
```

| Field | Values |
|-------|--------|
| `status` | Always `"running"` while UniPrint is alive |
| `printer` | `"connected"` or `"disconnected"` |
| `printerName` | Detected printer name, or `null` |
| `queue` | Number of jobs currently pending or processing |

---

### GET /printers

Returns all detected USB and Windows thermal printers.

**Response `200 OK`**

```json
{
  "printers": [
    {
      "type": "usb",
      "name": "USB Thermal Printer (0483:B500)",
      "vid":  "0483",
      "pid":  "b500"
    },
    {
      "type":        "windows",
      "name":        "EPSON TM-T20III",
      "portName":    "USB001",
      "windowsName": "EPSON TM-T20III"
    }
  ]
}
```

---

### POST /pair — Automatic Pairing

Allows your web application to request domain authorization without manual whitelist configuration. This endpoint does **not** require authentication.

When called, UniPrint displays a native dialog on the cashier's PC asking the user to approve or deny the request. If approved, the origin is permanently added to the whitelist.

**Request**

```http
POST http://127.0.0.1:3010/pair
Content-Type: application/json
Origin: https://yourapp.com
```

```json
{
  "name": "My POS System"
}
```

`name` is the application name shown in the approval dialog. It is optional.

**Responses**

| HTTP | Body | Meaning |
|------|------|---------|
| `200` | `{ "status": "approved" }` | User approved — origin added to whitelist |
| `200` | `{ "status": "already_paired" }` | Origin was already whitelisted |
| `403` | `{ "status": "denied" }` | User clicked Deny |
| `429` | `{ "retryAfter": 54 }` | Cooldown active (one attempt per origin per 60 seconds) |

**Pairing flow for your integration:**

```javascript
async function ensurePaired(port, appName) {
  const res = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: appName }),
  });

  const body = await res.json();

  if (body.status === 'approved' || body.status === 'already_paired') {
    return true;
  }

  if (res.status === 403) {
    throw new Error('Pairing denied by user');
  }

  if (res.status === 429) {
    throw new Error(`Pairing cooldown. Retry in ${body.retryAfter}s`);
  }

  return false;
}
```

> Note: The pairing dialog blocks the HTTP response until the user clicks a button. Set an appropriate timeout on your fetch call (recommended: 60 seconds).

---

### WebSocket

Subscribe to real-time job lifecycle events.

**Connection**

```
ws://127.0.0.1:3010/
```

The `Origin` header must match a whitelisted domain. The connection is rejected with `403` otherwise.

**Authentication**

Send an auth message within **5 seconds** of connecting or the connection is closed:

```json
{ "event": "auth", "token": "<api-key>" }
```

**Server response on success:**

```json
{ "event": "auth", "status": "ok" }
```

**Server response on failure:**

```json
{ "event": "auth", "status": "error", "error": "Invalid token" }
```

The connection is terminated immediately on a failed auth.

**Events received after authentication**

| Event | Payload | Description |
|-------|---------|-------------|
| `status` | `{ printer, printerName, queue }` | Sent every 5 seconds |
| `job:enqueued` | `{ id, queueLength }` | Job was accepted and queued |
| `job:processing` | `{ id, attempt }` | Job is being sent to the printer |
| `job:done` | `{ id }` | Job printed successfully |
| `job:failed` | `{ id, error }` | Job failed after all retry attempts |

**Messages you can send**

| Event | Description |
|-------|-------------|
| `{ "event": "ping" }` | Server replies with `{ "event": "pong" }` |

Ping is rate-limited to **10 per minute** per connection. Exceeding this closes the connection.

**Complete example**

```javascript
class UniPrintSocket {
  constructor(port, apiKey) {
    this._port   = port;
    this._apiKey = apiKey;
    this._ws     = null;
  }

  connect() {
    this._ws = new WebSocket(`ws://127.0.0.1:${this._port}/`);

    this._ws.addEventListener('open', () => {
      this._ws.send(JSON.stringify({ event: 'auth', token: this._apiKey }));
    });

    this._ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);

      if (msg.event === 'auth' && msg.status === 'ok') {
        console.log('UniPrint connected');
      } else if (msg.event === 'job:done') {
        console.log('Printed:', msg.id);
      } else if (msg.event === 'job:failed') {
        console.error('Print failed:', msg.id, msg.error);
      } else if (msg.event === 'status') {
        console.log('Printer:', msg.printer, '| Queue:', msg.queue);
      }
    });

    this._ws.addEventListener('close', () => {
      setTimeout(() => this.connect(), 3000);
    });
  }
}
```

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| **Network binding** | `127.0.0.1` only — unreachable from any other machine on the network |
| **Origin validation** | Every request checks the `Origin` header against the whitelist. No wildcard (`*`) is ever returned. |
| **API key storage** | Only a SHA-256 hash is stored. The plaintext key is discarded immediately after hashing. |
| **API key comparison** | Uses `crypto.timingSafeEqual` to prevent timing-based side-channel attacks. |
| **Rate limiting** | 10 requests per 5 seconds per origin. Prevents runaway loops from flooding the queue. |
| **Queue capacity** | Maximum 100 pending jobs. Excess requests receive `503`. |
| **Print schema** | Websites send structured JSON. UniPrint generates all ESC/POS internally. Raw printer commands are never accepted. |
| **WebSocket auth** | First message must authenticate within 5 seconds. Maximum 10 simultaneous authenticated connections. |
| **Renderer isolation** | Electron context isolation and sandbox are enforced. The renderer has no access to Node.js APIs. |
| **DevTools** | Blocked in production builds (F12, Ctrl+Shift+I/J/C). |

---

## Rate Limiting

UniPrint enforces a **sliding window** rate limit per origin:

- **Limit:** 10 requests per 5 seconds
- **Scope:** Per `Origin` header value (not per IP, since all requests come from localhost)
- **Response when exceeded:** `429 Too Many Requests`

```json
{
  "error": "Too many requests",
  "retryAfter": 5
}
```

`/pair` uses a separate, stricter limit: **1 attempt per origin per 60 seconds**.

---

## Troubleshooting

**The app window does not open**

Double-click the UniPrint icon in the system tray. If there is no tray icon, UniPrint is not running — launch it from the Start Menu.

**Dashboard shows "Offline" for the printer**

- Confirm the printer is plugged in and powered on.
- Go to **Printers → Refresh**, then click **Select** on your printer.
- Click **Reconnect Printer** on the Dashboard.
- If using a USB printer, try a different USB port.

**Requests return `403 Origin not authorized`**

The `Origin` header in your request does not match any whitelisted entry. Check:
- Protocol matches exactly (`https://` vs `http://`).
- Hostname matches exactly (with or without `www.`).
- Port is included if non-standard (e.g. `http://localhost:3000`, not `http://localhost`).

**Requests return `401 Missing authorization` or `Invalid API key`**

- Confirm the key your web app sends matches exactly what you typed into UniPrint.
- Keys are case-sensitive. Ensure there are no leading or trailing spaces.
- If you cleared and reset the key in UniPrint, update your web app configuration to match.

**Print jobs are accepted but nothing prints**

- Check the Dashboard queue counter — if it is rising, jobs are queuing but not printing.
- Go to **Logs** and look for error messages after the job was accepted.
- Click **Test Print** on the Dashboard to verify the printer works independently.
- Ensure a printer is selected in the **Printers** tab.

**Port discovery fails — all ports 3010–3015 are unavailable**

Check if another instance of UniPrint is already running (look for the tray icon). UniPrint enforces a single-instance lock, so a second launch will bring the existing window to focus. If ports are occupied by another application, close that application.

**`POST /pair` times out**

The pairing dialog is waiting for user input on the cashier's PC. Ensure the UniPrint window is visible and the user can see the approval prompt. The dialog has no automatic timeout — it stays open until the user responds.

---

## Building from Source

**Prerequisites**

- Node.js 18 or later
- npm 9 or later
- Windows 10/11 with Visual C++ Build Tools (required for the `usb` native module)

**Clone and install**

```bash
git clone https://github.com/uniprint-app/uniprint.git
cd uniprint
npm install
```

**Rebuild native modules**

```bash
npm run rebuild
```

This compiles the `usb` native addon against the bundled Electron version. Run this after every `npm install` or Electron version change.

**Run in development mode**

```bash
npm run dev
```

DevTools are available in development mode (F12).

**Build the Windows installer**

```bash
npm run build:win
```

The installer is written to `dist/UniPrint-Setup-1.0.0.exe`.

**Place icon assets before building**

Before running `build:win`, add these two files to the `assets/` folder:

| File | Purpose |
|------|---------|
| `assets/uniprint.ico` | Window icon, tray icon, NSIS installer icon |
| `assets/uniprint.png` | Wide logo shown in the app header |

See `assets/ICONS.md` for recommended dimensions.
