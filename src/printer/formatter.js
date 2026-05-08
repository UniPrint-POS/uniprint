const INIT          = Buffer.from([0x1b, 0x40]);
const ALIGN_LEFT    = Buffer.from([0x1b, 0x61, 0x00]);
const ALIGN_CENTER  = Buffer.from([0x1b, 0x61, 0x01]);
const ALIGN_RIGHT   = Buffer.from([0x1b, 0x61, 0x02]);
const BOLD_ON       = Buffer.from([0x1b, 0x45, 0x01]);
const BOLD_OFF      = Buffer.from([0x1b, 0x45, 0x00]);
const UNDERLINE_ON  = Buffer.from([0x1b, 0x2d, 0x01]);
const UNDERLINE_OFF = Buffer.from([0x1b, 0x2d, 0x00]);
const SIZE_DOUBLE   = Buffer.from([0x1d, 0x21, 0x11]);
const SIZE_NORMAL   = Buffer.from([0x1d, 0x21, 0x00]);
const SIZE_WIDE     = Buffer.from([0x1d, 0x21, 0x10]);
const NEWLINE       = Buffer.from([0x0a]);
const CUT_PARTIAL   = Buffer.from([0x1d, 0x56, 0x01]);
const FEED_3        = Buffer.from([0x1b, 0x64, 0x03]);
const FEED_4        = Buffer.from([0x1b, 0x64, 0x04]);

const PAPER_CHAR_WIDTH = { 80: 48, 58: 32 };

function isWide(cp) {
  return (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x2E80 && cp <= 0x9FFF) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE30 && cp <= 0xFE4F) ||
    (cp >= 0xFF01 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6);
}

function visualWidth(str) {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

function sanitize(str) {
  if (typeof str !== 'string') str = String(str ?? '');
  return str.replace(/[\x00-\x1F\x7F]/g, '');
}

function pad(str, width, align = 'left') {
  str = sanitize(str);
  const vw = visualWidth(str);
  if (vw >= width) {
    let result = '';
    let used = 0;
    for (const ch of str) {
      const cp = ch.codePointAt(0);
      const cw = isWide(cp) ? 2 : 1;
      if (used + cw > width) break;
      result += ch;
      used += cw;
    }
    return result;
  }
  const spaces = ' '.repeat(width - vw);
  if (align === 'right') return spaces + str;
  if (align === 'center') {
    const half = Math.floor((width - vw) / 2);
    return ' '.repeat(half) + str + ' '.repeat(width - vw - half);
  }
  return str + spaces;
}

function divider(width) {
  return Buffer.concat([Buffer.from('-'.repeat(width)), NEWLINE]);
}

function cols(left, right, width) {
  left = sanitize(left);
  right = sanitize(right);
  const rvw = visualWidth(right);
  const available = width - rvw;
  const leftPadded = pad(left, Math.max(0, available), 'left');
  return Buffer.concat([Buffer.from(leftPadded + right), NEWLINE]);
}

function line(str) {
  return Buffer.concat([Buffer.from(sanitize(str)), NEWLINE]);
}

function centerLine(str) {
  return Buffer.concat([ALIGN_CENTER, line(str), ALIGN_LEFT]);
}

function fmtMoney(val) {
  if (typeof val === 'number') return val.toFixed(2);
  return String(val ?? '0.00');
}

function fmtDateTime(ts) {
  try {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleString('en-US', { hour12: false });
  } catch {
    return new Date().toLocaleString('en-US', { hour12: false });
  }
}

function encodeCode128(data) {
  const START_B = 104;
  const STOP = 106;
  const dataBytes = Buffer.from(data, 'ascii');
  const charValues = [];
  for (const b of dataBytes) {
    charValues.push(b - 32);
  }
  let checksum = START_B;
  for (let i = 0; i < charValues.length; i++) {
    checksum = (checksum + (i + 1) * charValues[i]) % 103;
  }
  const innerData = Buffer.from([0x7b, 0x42, ...dataBytes]);
  return innerData;
}

function formatTest(data, width) {
  const parts = [
    INIT,
    ALIGN_CENTER,
    BOLD_ON,
    Buffer.from('UniPrint'), NEWLINE,
    BOLD_OFF,
    Buffer.from('Printer Test'), NEWLINE,
    ALIGN_LEFT,
    divider(width),
    Buffer.from('Status: OK'), NEWLINE,
    Buffer.from(`Paper: ${width === 80 ? 80 : 58}mm`), NEWLINE,
    Buffer.from(`Date: ${new Date().toLocaleString('en-US', { hour12: false })}`), NEWLINE,
    divider(width),
    ALIGN_CENTER,
    Buffer.from('Test successful'), NEWLINE,
    ALIGN_LEFT,
    FEED_3,
    CUT_PARTIAL,
  ];
  return Buffer.concat(parts);
}

function formatReceipt(data, width) {
  const d = data || {};
  const parts = [INIT];

  if (d.storeName) {
    parts.push(ALIGN_CENTER, SIZE_DOUBLE, BOLD_ON, Buffer.from(sanitize(d.storeName)), NEWLINE, SIZE_NORMAL, BOLD_OFF);
  }
  if (d.storeAddress) {
    parts.push(ALIGN_CENTER, Buffer.from(sanitize(d.storeAddress)), NEWLINE);
  }
  if (d.storePhone) {
    parts.push(ALIGN_CENTER, Buffer.from(sanitize(d.storePhone)), NEWLINE);
  }

  parts.push(ALIGN_LEFT);

  if (d.cashier && d.receiptNumber) {
    parts.push(cols(`Cashier: ${sanitize(d.cashier)}`, `#${sanitize(d.receiptNumber)}`, width));
  } else if (d.cashier) {
    parts.push(Buffer.from(`Cashier: ${sanitize(d.cashier)}`), NEWLINE);
  } else if (d.receiptNumber) {
    parts.push(Buffer.from(`Receipt: #${sanitize(d.receiptNumber)}`), NEWLINE);
  }

  if (d.timestamp) {
    parts.push(ALIGN_CENTER, Buffer.from(fmtDateTime(d.timestamp)), NEWLINE, ALIGN_LEFT);
  } else {
    parts.push(ALIGN_CENTER, Buffer.from(fmtDateTime(null)), NEWLINE, ALIGN_LEFT);
  }

  parts.push(divider(width));

  const col1 = Math.floor(width * 0.45);
  const col2 = Math.floor(width * 0.1);
  const col3 = width - col1 - col2;

  parts.push(Buffer.from(pad('ITEM', col1) + pad('QTY', col2, 'right') + pad('PRICE', col3, 'right')), NEWLINE);

  const items = Array.isArray(d.items) ? d.items : [];
  for (const item of items) {
    const name = sanitize(item.name || '');
    const qty = String(item.qty ?? '');
    const total = fmtMoney(item.total ?? (item.qty * item.unitPrice));
    parts.push(Buffer.from(pad(name, col1) + pad(qty, col2, 'right') + pad(total, col3, 'right')), NEWLINE);
  }

  parts.push(divider(width));

  const moneyCol = width;
  const labelW = Math.floor(width * 0.55);
  const amountW = width - labelW;

  if (d.subtotal !== undefined && d.subtotal !== null) {
    parts.push(cols('Subtotal:', `$${fmtMoney(d.subtotal)}`, width));
  }
  if (d.discount && Number(d.discount) > 0) {
    parts.push(cols('Discount:', `-$${fmtMoney(d.discount)}`, width));
  }
  if (d.tax && Number(d.tax) > 0) {
    parts.push(cols('Tax:', `$${fmtMoney(d.tax)}`, width));
  }

  parts.push(BOLD_ON, cols('TOTAL:', `$${fmtMoney(d.total)}`, width), BOLD_OFF);
  parts.push(divider(width));

  if (d.payment) {
    parts.push(cols('Payment:', sanitize(String(d.payment)), width));
  }
  if (d.received !== undefined && d.received !== null) {
    parts.push(cols('Received:', `$${fmtMoney(d.received)}`, width));
  }
  if (d.change !== undefined && d.change !== null) {
    parts.push(cols('Change:', `$${fmtMoney(d.change)}`, width));
  }

  parts.push(divider(width));

  if (d.notes) {
    parts.push(ALIGN_CENTER, Buffer.from(sanitize(d.notes)), NEWLINE);
  }

  const footer = d.footer ? sanitize(d.footer) : 'Thank you for your purchase!';
  parts.push(ALIGN_CENTER, Buffer.from(footer), NEWLINE, ALIGN_LEFT);

  parts.push(FEED_4, CUT_PARTIAL);

  return Buffer.concat(parts);
}

function formatLabel(data, width) {
  const d = data || {};
  const parts = [INIT];

  if (d.title) {
    parts.push(ALIGN_CENTER, SIZE_DOUBLE, BOLD_ON, Buffer.from(sanitize(d.title)), NEWLINE, SIZE_NORMAL, BOLD_OFF);
  }
  if (d.subtitle) {
    parts.push(ALIGN_CENTER, Buffer.from(sanitize(d.subtitle)), NEWLINE);
  }
  if (d.price !== undefined && d.price !== null) {
    parts.push(ALIGN_CENTER, BOLD_ON, Buffer.from(`$${sanitize(String(d.price))}`), NEWLINE, BOLD_OFF);
  }

  parts.push(ALIGN_LEFT, divider(width));

  const lines = Array.isArray(d.lines) ? d.lines : [];
  for (const ln of lines) {
    parts.push(Buffer.from(sanitize(String(ln))), NEWLINE);
  }

  if (d.barcode && typeof d.barcode === 'string' && d.barcode.length > 0) {
    const barcodeStr = d.barcode.slice(0, 48).replace(/[^\x20-\x7E]/g, '');
    if (barcodeStr.length > 0) {
      const innerData = encodeCode128(barcodeStr);
      parts.push(ALIGN_CENTER);
      parts.push(Buffer.from([0x1d, 0x68, 0x50]));
      parts.push(Buffer.from([0x1d, 0x77, 0x02]));
      parts.push(Buffer.from([0x1d, 0x48, 0x02]));
      parts.push(Buffer.from([0x1d, 0x6b, 0x49, innerData.length, ...innerData]));
      parts.push(NEWLINE, ALIGN_LEFT);
    }
  }

  parts.push(FEED_3, CUT_PARTIAL);

  return Buffer.concat(parts);
}

function format(template, data, paperWidth) {
  const width = PAPER_CHAR_WIDTH[paperWidth] || 48;

  switch (template) {
    case 'test':
      return formatTest(data, width);
    case 'receipt':
      return formatReceipt(data, width);
    case 'label':
      return formatLabel(data, width);
    default:
      throw new Error(`Unknown template: ${template}`);
  }
}

module.exports = { format };
