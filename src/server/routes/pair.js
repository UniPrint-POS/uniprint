const pairAttempts = new Map();
const PAIR_COOLDOWN_MS = 60000;

module.exports = function makePairRouter(ipcEmitter) {
  const router = require('express').Router();

  router.post('/', async (req, res) => {
    const origin = req.headers.origin;
    if (!origin) return res.status(400).json({ error: 'Origin header required' });

    const config = require('../../utils/config');

    if (config.isWhitelisted(origin)) {
      return res.json({ status: 'already_paired' });
    }

    const lastAttempt = pairAttempts.get(origin) || 0;
    const now = Date.now();
    if (now - lastAttempt < PAIR_COOLDOWN_MS) {
      return res.status(429).json({
        error: 'Pairing cooldown active',
        retryAfter: Math.ceil((PAIR_COOLDOWN_MS - (now - lastAttempt)) / 1000),
      });
    }

    pairAttempts.set(origin, now);

    const { name } = req.body;
    const appName = typeof name === 'string' ? name.slice(0, 64) : origin;

    try {
      const approved = await ipcEmitter.showPairRequest(origin, appName);

      if (approved) {
        config.addToWhitelist(origin);
        return res.json({ status: 'approved' });
      } else {
        return res.status(403).json({ status: 'denied', error: 'User denied pairing request' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Pairing request failed' });
    }
  });

  return router;
};
