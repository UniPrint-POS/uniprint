const { body, validationResult } = require('express-validator');

const receiptRules = [
  body('data.items')
    .isArray({ min: 1, max: 200 })
    .withMessage('items must be an array with 1-200 entries'),
  body('data.items.*.name')
    .isString()
    .notEmpty()
    .withMessage('Each item must have a name string'),
  body('data.items.*.qty')
    .isNumeric()
    .withMessage('Each item must have a numeric qty'),
  body('data.items.*.unitPrice')
    .isNumeric()
    .withMessage('Each item must have a numeric unitPrice'),
  body('data.total')
    .isFloat({ min: 0 })
    .withMessage('total must be a non-negative number'),
  body('data.storeName').optional().isString().isLength({ max: 128 }),
  body('data.storeAddress').optional().isString().isLength({ max: 256 }),
  body('data.storePhone').optional().isString().isLength({ max: 64 }),
  body('data.cashier').optional().isString().isLength({ max: 64 }),
  body('data.receiptNumber').optional().isString().isLength({ max: 64 }),
  body('data.timestamp').optional().isString(),
  body('data.subtotal').optional().isNumeric(),
  body('data.discount').optional().isNumeric(),
  body('data.tax').optional().isNumeric(),
  body('data.payment').optional().isString().isLength({ max: 32 }),
  body('data.received').optional().isNumeric(),
  body('data.change').optional().isNumeric(),
  body('data.notes').optional().isString().isLength({ max: 512 }),
  body('data.footer').optional().isString().isLength({ max: 256 }),
];

const labelRules = [
  body('data.title').optional().isString().isLength({ max: 128 }),
  body('data.subtitle').optional().isString().isLength({ max: 128 }),
  body('data.price').optional().isString().isLength({ max: 32 }),
  body('data.barcode').optional().isString().isLength({ max: 48 }),
  body('data.lines').optional().isArray({ max: 20 }),
  body('data.lines.*').optional().isString().isLength({ max: 256 }),
];

const templateRule = body('template')
  .isIn(['receipt', 'label', 'test'])
  .withMessage('template must be one of: receipt, label, test');

const rules = [
  templateRule,
  body().custom((value, { req }) => {
    const t = req.body.template;
    if (t === 'receipt') return true;
    if (t === 'label') return true;
    if (t === 'test') return true;
    return true;
  }),
];

function validateMiddleware(req, res, next) {
  const t = req.body && req.body.template;

  const chain = [templateRule];
  if (t === 'receipt') chain.push(...receiptRules);
  else if (t === 'label') chain.push(...labelRules);

  let idx = 0;
  function runNext(err) {
    if (err) return next(err);
    if (idx >= chain.length) {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      return next();
    }
    const validator = chain[idx++];
    validator(req, res, runNext);
  }

  runNext();
}

module.exports = validateMiddleware;
