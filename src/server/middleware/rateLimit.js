const WINDOW_MS = 5000;
const MAX_REQUESTS = 10;
const originWindows = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [origin, timestamps] of originWindows) {
    const active = timestamps.filter(t => now - t < WINDOW_MS);
    if (active.length === 0) originWindows.delete(origin);
    else originWindows.set(origin, active);
  }
}, 30000);

module.exports = function rateLimitMiddleware(req, res, next) {
  const origin = req.headers.origin || req.ip;
  const now = Date.now();
  const timestamps = (originWindows.get(origin) || []).filter(t => now - t < WINDOW_MS);
  if (timestamps.length >= MAX_REQUESTS) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.ceil(WINDOW_MS / 1000),
    });
  }
  timestamps.push(now);
  originWindows.set(origin, timestamps);
  next();
};
