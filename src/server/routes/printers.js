module.exports = function makePrintersRouter(printerManager) {
  const router = require('express').Router();

  router.get('/', async (req, res) => {
    try {
      const printers = await printerManager.listAll();
      res.json({ printers });
    } catch {
      res.json({ printers: [] });
    }
  });

  return router;
};
