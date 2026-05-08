const { createHash, timingSafeEqual } = require('crypto');
const Store = require('electron-store');

const schema = {
  paperWidth: {
    type: 'number',
    enum: [58, 80],
    default: 80,
  },
  autoStart: {
    type: 'boolean',
    default: false,
  },
  selectedPrinter: {
    default: null,
  },
  whitelist: {
    type: 'array',
    items: { type: 'string' },
    default: [],
  },
  apiKeyHash: {
    type: 'string',
    default: '',
  },
};

const store = new Store({ schema });

function normalizeOrigin(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const port = u.port ? `:${u.port}` : '';
    return `${u.protocol}//${u.hostname}${port}`;
  } catch {
    return null;
  }
}

function getAll() {
  return {
    paperWidth: store.get('paperWidth', 80),
    autoStart: store.get('autoStart', false),
    selectedPrinter: store.get('selectedPrinter', null),
    whitelist: store.get('whitelist', []),
    hasApiKey: store.get('apiKeyHash', '') !== '',
  };
}

function get(key) {
  return store.get(key);
}

function set(key, value) {
  store.set(key, value);
}

function setApiKey(plainKey) {
  if (typeof plainKey !== 'string' || plainKey.trim().length < 16) {
    throw new Error('API key must be at least 16 characters');
  }
  const hash = createHash('sha256').update(plainKey.trim()).digest('hex');
  store.set('apiKeyHash', hash);
}

function clearApiKey() {
  store.set('apiKeyHash', '');
}

function verifyApiKey(plainKey) {
  const storedHash = store.get('apiKeyHash', '');
  if (!storedHash) return false;
  const computedHash = createHash('sha256').update(plainKey.trim()).digest('hex');
  if (storedHash.length !== computedHash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(storedHash), Buffer.from(computedHash));
  } catch {
    return false;
  }
}

function getWhitelist() {
  return store.get('whitelist', []);
}

function addToWhitelist(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) throw new Error('Invalid origin format');
  const list = getWhitelist();
  if (list.includes(normalized)) return;
  list.push(normalized);
  store.set('whitelist', list);
}

function removeFromWhitelist(origin) {
  const normalized = normalizeOrigin(origin) || origin;
  const list = getWhitelist().filter(o => o !== normalized);
  store.set('whitelist', list);
}

function isWhitelisted(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return getWhitelist().includes(normalized);
}

module.exports = {
  getAll,
  get,
  set,
  setApiKey,
  clearApiKey,
  verifyApiKey,
  getWhitelist,
  addToWhitelist,
  removeFromWhitelist,
  isWhitelisted,
  normalizeOrigin,
};
