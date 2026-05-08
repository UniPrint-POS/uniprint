module.exports = function makeStatusRouter(printerManager, queue) {
  const router = require('express').Router();

  router.get('/', (req, res) => {
    const status = printerManager.getStatus();
    res.json({
      status: 'running',
      version: require('../../../package.json').version,
      printer: status.connected ? 'connected' : 'disconnected',
      printerName: status.name || null,
      queue: queue.length,
    });
  });

  return router;
};
