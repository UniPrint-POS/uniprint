const { createHash, timingSafeEqual, randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } = require('crypto');
const Store = require('electron-store');

const schema = {
  paperWidth:        { type: 'number', enum: [58, 80], default: 80 },
  autoStart:         { type: 'boolean', default: false },
  selectedPrinter:   { default: null },
  whitelist:         { type: 'array', items: { type: 'string' }, default: [] },
  apiKeyHash:        { type: 'string', default: '' },
  apiKeyEncrypted:   { type: 'string', default: '' },
  accountPinHash:    { type: 'string', default: '' },
  accountPinSetPage: { type: 'string', default: '' },
};

const store = new Store({ schema });

// ── AES-256-GCM helpers ──────────────────────────────────────

function _encryptValue(plaintext, pin) {
  const salt = randomBytes(32);
  const iv   = randomBytes(12);
  const key  = pbkdf2Sync(pin, salt, 200000, 32, 'sha256');
  const ciph = createCipheriv('aes-256-gcm', key, iv);
  const ct   = Buffer.concat([ciph.update(plaintext, 'utf8'), ciph.final()]);
  const tag  = ciph.getAuthTag();
  return JSON.stringify({
    salt: salt.toString('base64'),
    iv:   iv.toString('base64'),
    tag:  tag.toString('base64'),
    ct:   ct.toString('base64'),
  });
}

function _decryptValue(blob, pin) {
  const { salt, iv, tag, ct } = JSON.parse(blob);
  const key = pbkdf2Sync(pin, Buffer.from(salt, 'base64'), 200000, 32, 'sha256');
  const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  dec.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([dec.update(Buffer.from(ct, 'base64')), dec.final()]).toString('utf8');
}

// ── Origin normalisation ────────────────────────────────────

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

// ── Account PIN ──────────────────────────────────────────────

function hasAccountPin() {
  return store.get('accountPinHash', '') !== '';
}

function getAccountPinSetPage() {
  return store.get('accountPinSetPage', '');
}

function setupAccountPin(pin, page) {
  if (typeof pin !== 'string' || pin.length < 4) {
    throw new Error('PIN must be at least 4 characters');
  }
  if (hasAccountPin()) {
    throw new Error('Account PIN is already set');
  }
  const salt    = randomBytes(32);
  const derived = pbkdf2Sync(pin, salt, 200000, 32, 'sha256');
  store.set('accountPinHash', JSON.stringify({
    salt: salt.toString('base64'),
    hash: derived.toString('base64'),
  }));
  store.set('accountPinSetPage', page);
}

function verifyAccountPin(pin) {
  const raw = store.get('accountPinHash', '');
  if (!raw) return false;
  try {
    const { salt, hash } = JSON.parse(raw);
    const derived   = pbkdf2Sync(pin, Buffer.from(salt, 'base64'), 200000, 32, 'sha256');
    const storedBuf = Buffer.from(hash, 'base64');
    if (derived.length !== storedBuf.length) return false;
    return timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}

function _maybeClearAccountPin() {
  const noKey       = store.get('apiKeyHash', '') === '';
  const noWhitelist = store.get('whitelist', []).length === 0;
  if (noKey && noWhitelist) {
    store.set('accountPinHash', '');
    store.set('accountPinSetPage', '');
  }
}

// ── General config ───────────────────────────────────────────

function getAll() {
  return {
    paperWidth:        store.get('paperWidth', 80),
    autoStart:         store.get('autoStart', false),
    selectedPrinter:   store.get('selectedPrinter', null),
    hasApiKey:         store.get('apiKeyHash', '') !== '',
    hasAccountPin:     hasAccountPin(),
    accountPinSetPage: getAccountPinSetPage(),
  };
}

function get(key) {
  return store.get(key);
}

function set(key, value) {
  store.set(key, value);
}

// ── API Key ──────────────────────────────────────────────────

function setApiKey(plainKey, pin) {
  if (typeof plainKey !== 'string' || plainKey.trim().length < 16) {
    throw new Error('API key must be at least 16 characters');
  }
  if (!verifyAccountPin(pin)) {
    throw new Error('Incorrect PIN');
  }
  const trimmed = plainKey.trim();
  store.set('apiKeyHash',      createHash('sha256').update(trimmed).digest('hex'));
  store.set('apiKeyEncrypted', _encryptValue(trimmed, pin));
}

function clearApiKey() {
  store.set('apiKeyHash', '');
  store.set('apiKeyEncrypted', '');
  _maybeClearAccountPin();
}

function revealApiKey(pin) {
  if (!verifyAccountPin(pin)) return null;
  const blob = store.get('apiKeyEncrypted', '');
  if (!blob) return null;
  try {
    return _decryptValue(blob, pin);
  } catch {
    return null;
  }
}

function verifyApiKey(plainKey) {
  const stored = store.get('apiKeyHash', '');
  if (!stored) return false;
  const computed = createHash('sha256').update(plainKey.trim()).digest('hex');
  if (stored.length !== computed.length) return false;
  try {
    return timingSafeEqual(Buffer.from(stored), Buffer.from(computed));
  } catch {
    return false;
  }
}

// ── Whitelist ────────────────────────────────────────────────

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
  store.set('whitelist', getWhitelist().filter(o => o !== normalized));
}

function clearWhitelist() {
  store.set('whitelist', []);
  _maybeClearAccountPin();
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
  hasAccountPin,
  getAccountPinSetPage,
  setupAccountPin,
  verifyAccountPin,
  setApiKey,
  clearApiKey,
  revealApiKey,
  verifyApiKey,
  getWhitelist,
  addToWhitelist,
  removeFromWhitelist,
  clearWhitelist,
  isWhitelisted,
  normalizeOrigin,
};
