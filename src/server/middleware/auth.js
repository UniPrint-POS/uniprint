const config = require('../../utils/config');
const { logger } = require('../../utils/logger');

module.exports = function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization' });
  }
  const provided = header.slice(7);
  if (!config.verifyApiKey(provided)) {
    logger.warn(`Auth failure from ${req.ip}`);
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};
