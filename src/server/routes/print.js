const { validationResult } = require('express-validator');

module.exports = function makePrintRouter(queue) {
  const router = require('express').Router();

  router.post('/', (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { template, data } = req.body;
    try {
      const id = queue.enqueue({ template, data });
      res.status(202).json({ status: 'accepted', jobId: id, queueLength: queue.length });
    } catch (err) {
      res.status(503).json({ error: err.message });
    }
  });

  return router;
};
