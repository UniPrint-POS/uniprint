const http = require('http');
const express = require('express');
const helmet = require('helmet');

const corsMiddleware = require('./middleware/cors');
const authMiddleware = require('./middleware/auth');
const rateLimitMiddleware = require('./middleware/rateLimit');
const validateMiddleware = require('./middleware/validate');

const makePrintRouter = require('./routes/print');
const makePrintersRouter = require('./routes/printers');
const makeStatusRouter = require('./routes/status');
const makePairRouter = require('./routes/pair');
const ws = require('./websocket');

const { logger } = require('../utils/logger');

const FALLBACK_PORTS = [3010, 3011, 3012, 3013, 3014, 3015];

async function tryListen(server, port) {
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve(port));
    server.once('error', reject);
  });
}

async function start(printerManager, queue, ipcEmitter) {
  const app = express();

  app.set('trust proxy', false);

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  app.use(express.json({ limit: '50kb' }));

  const pairRouter = makePairRouter(ipcEmitter);
  const printRouter = makePrintRouter(queue);
  const printersRouter = makePrintersRouter(printerManager);
  const statusRouter = makeStatusRouter(printerManager, queue);

  app.use('/pair', rateLimitMiddleware, pairRouter);

  app.use(corsMiddleware);
  app.use(authMiddleware);
  app.use(rateLimitMiddleware);

  app.use('/print', validateMiddleware, printRouter);
  app.use('/printers', printersRouter);
  app.use('/status', statusRouter);

  app.use((err, req, res, next) => {
    logger.error(`Server error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = http.createServer(app);

  let port = null;
  for (const p of FALLBACK_PORTS) {
    try {
      await tryListen(server, p);
      port = p;
      break;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }

  if (!port) throw new Error('No available ports in range');

  const wss = ws.start(server, printerManager, queue);

  logger.info(`UniPrint server listening on port ${port}`);

  return { port, server, wss };
}

module.exports = { start };
