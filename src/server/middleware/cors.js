const config = require('../../utils/config');

module.exports = function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  if (req.method === 'OPTIONS') {
    if (origin && config.isWhitelisted(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    return res.status(204).end();
  }

  if (!origin || !config.isWhitelisted(origin)) {
    return res.status(403).json({ error: 'Origin not authorized' });
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  next();
};
