const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

const MAX_PENDING = 100;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const MAX_HISTORY = 50;

class PrintQueue extends EventEmitter {
  constructor(printFn) {
    super();
    this._printFn = printFn;
    this._queue = [];
    this._processing = false;
    this._paused = false;
  }

  enqueue(job) {
    if (this.length >= MAX_PENDING) {
      throw new Error('Print queue is full');
    }
    const entry = {
      id: uuidv4(),
      job,
      attempts: 0,
      status: 'pending',
      createdAt: new Date(),
      error: null,
    };
    this._queue.push(entry);
    this.emit('enqueued', { id: entry.id, queueLength: this.length });
    this._tick();
    return entry.id;
  }

  get length() {
    return this._queue.filter(e => e.status === 'pending' || e.status === 'processing').length;
  }

  snapshot() {
    return [...this._queue];
  }

  pause() {
    this._paused = true;
  }

  resume() {
    this._paused = false;
    this._tick();
  }

  _tick() {
    if (this._processing || this._paused) return;
    const entry = this._queue.find(e => e.status === 'pending');
    if (!entry) return;
    this._process(entry);
  }

  async _process(entry) {
    this._processing = true;
    entry.status = 'processing';
    entry.attempts += 1;
    this.emit('processing', { id: entry.id, attempt: entry.attempts });

    try {
      await this._printFn(entry.job);
      entry.status = 'done';
      this.emit('done', { id: entry.id });
    } catch (err) {
      entry.error = err.message || String(err);
      this.emit('error', { id: entry.id, error: entry.error, attempt: entry.attempts });

      if (entry.attempts < MAX_RETRIES) {
        entry.status = 'pending';
        const delay = RETRY_BASE_MS * Math.pow(2, entry.attempts - 1);
        setTimeout(() => this._tick(), delay);
      } else {
        entry.status = 'failed';
        this.emit('failed', { id: entry.id, error: entry.error });
      }
    } finally {
      this._processing = false;
      this._trim();
      setImmediate(() => this._tick());
    }
  }

  _trim() {
    const active = this._queue.filter(e => e.status === 'pending' || e.status === 'processing');
    const finished = this._queue.filter(e => e.status === 'done' || e.status === 'failed');
    const trimmedFinished = finished.slice(-MAX_HISTORY);
    this._queue = [...active, ...trimmedFinished];
  }
}

module.exports = PrintQueue;
