const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

const BUFFER_SIZE = 500;
const buffer = [];
const listeners = new Set();

let _app = null;

function getLogDir() {
  if (_app) return path.join(_app.getPath('userData'), 'logs');
  return path.join(process.cwd(), 'logs');
}

function initWinston() {
  const transports = [
    new winston.transports.DailyRotateFile({
      dirname: getLogDir(),
      filename: 'uniprint-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      maxSize: '20m',
      zippedArchive: true,
    }),
  ];

  if (process.env.NODE_ENV === 'development') {
    transports.push(new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }));
  }

  return winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports,
  });
}

let _winston = null;

function getWinston() {
  if (!_winston) _winston = initWinston();
  return _winston;
}

function notify(entry) {
  for (const fn of listeners) {
    try { fn(entry); } catch {}
  }
}

function push(level, message) {
  const entry = { timestamp: new Date().toISOString(), level, message };
  buffer.push(entry);
  if (buffer.length > BUFFER_SIZE) buffer.shift();
  notify(entry);
  try {
    getWinston()[level](message);
  } catch {}
}

const logger = {
  info(message) { push('info', String(message)); },
  warn(message) { push('warn', String(message)); },
  error(message) { push('error', String(message)); },
};

function onEntry(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getBuffer() {
  return [...buffer];
}

function setApp(app) {
  _app = app;
  _winston = null;
}

module.exports = { logger, onEntry, getBuffer, setApp };
