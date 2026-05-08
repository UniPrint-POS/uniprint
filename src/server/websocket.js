const { WebSocketServer } = require('ws');
const config = require('../utils/config');
const { logger } = require('../utils/logger');

const MAX_CLIENTS = 10;
const AUTH_TIMEOUT_MS = 5000;
const MAX_MSG_SIZE = 4 * 1024;
const PING_LIMIT = 10;
const PING_WINDOW_MS = 60000;
const STATUS_INTERVAL_MS = 5000;

let wss = null;
let printerManagerRef = null;
let queueRef = null;
let statusInterval = null;

const clients = new Map();

function start(httpServer, printerManager, queue) {
  printerManagerRef = printerManager;
  queueRef = queue;

  wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_SIZE });

  httpServer.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    if (!origin || !config.isWhitelisted(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const authedCount = [...clients.values()].filter(c => c.authed).length;
    if (authedCount >= MAX_CLIENTS) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const clientId = `${req.socket.remoteAddress}:${Date.now()}`;
    const clientState = {
      authed: false,
      pingCount: 0,
      pingWindowStart: Date.now(),
    };
    clients.set(ws, clientState);

    const authTimer = setTimeout(() => {
      if (!clientState.authed) {
        ws.terminate();
        clients.delete(ws);
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (!clientState.authed) {
        if (msg.event === 'auth' && typeof msg.token === 'string') {
          if (config.verifyApiKey(msg.token)) {
            clientState.authed = true;
            clearTimeout(authTimer);
            ws.send(JSON.stringify({ event: 'auth', status: 'ok' }));
          } else {
            ws.send(JSON.stringify({ event: 'auth', status: 'error', error: 'Invalid token' }));
            ws.terminate();
            clients.delete(ws);
          }
        }
        return;
      }

      if (msg.event === 'ping') {
        const now = Date.now();
        if (now - clientState.pingWindowStart > PING_WINDOW_MS) {
          clientState.pingCount = 0;
          clientState.pingWindowStart = now;
        }
        clientState.pingCount++;
        if (clientState.pingCount > PING_LIMIT) {
          ws.terminate();
          clients.delete(ws);
          return;
        }
        ws.send(JSON.stringify({ event: 'pong' }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      clearTimeout(authTimer);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  statusInterval = setInterval(() => {
    broadcastStatus();
  }, STATUS_INTERVAL_MS);

  return wss;
}

function broadcast(event, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ event, ...payload });
  for (const [ws, state] of clients) {
    if (state.authed && ws.readyState === ws.OPEN) {
      try { ws.send(msg); } catch {}
    }
  }
}

function broadcastStatus() {
  if (!printerManagerRef || !queueRef) return;
  const status = printerManagerRef.getStatus();
  broadcast('status', {
    printer: status.connected ? 'connected' : 'disconnected',
    printerName: status.name || null,
    queue: queueRef.length,
  });
}

function stop() {
  if (statusInterval) clearInterval(statusInterval);
  if (wss) wss.close();
  clients.clear();
}

module.exports = { start, broadcast, broadcastStatus, stop };
