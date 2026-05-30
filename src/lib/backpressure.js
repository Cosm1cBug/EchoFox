/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';

/**
 * Batched-write helper for high-throughput store inserts.
 *
 *   const batcher = makeBatcher({
 *     name: 'pg-messages',
 *     maxBatch: 100,
 *     maxWaitMs: 250,
 *     maxBufferSize: 5000,        // back-pressure threshold
 *     flush: async (rows) => { ... bulk insert ... },
 *     onDrop:  (count) => { ... overflow handler ... },
 *   });
 *
 *   batcher.push(row);
 *   await batcher.drain();   // graceful flush before shutdown
 *
 * Behavior:
 *   • Coalesces individual push() calls into batches of up to maxBatch.
 *   • Flushes when either maxBatch is reached OR maxWaitMs elapses since
 *     the first row of the current batch.
 *   • If buffer overflows maxBufferSize, OLDEST rows are dropped and
 *     onDrop(count) is invoked — protects from unbounded memory growth
 *     when the downstream is slow / dead.
 *   • Concurrent flushes are serialized (one in-flight at a time).
 *   • If a flush throws, rows are NOT re-queued; we log + bump metric.
 *     Use durable persistence (SQLite WAL etc.) for guaranteed delivery.
 */

const logger  = require('../core/logger').child({ mod: 'backpressure' });
const metrics = require('../services/metrics');

function makeBatcher({
  name,
  flush,
  maxBatch       = 100,
  maxWaitMs      = 250,
  maxBufferSize  = 5_000,
  onDrop,
}) {
  if (!flush) throw new Error('backpressure: flush() required');
  let buffer = [];
  let timer  = null;
  let flushing = false;
  let pendingFlush = null;
  let droppedTotal = 0;

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(_doFlush, maxWaitMs);
    timer.unref?.();
  };

  async function _doFlush() {
    clearTimeout(timer); timer = null;
    if (flushing) {
      // Coalesce concurrent flush triggers — re-arm after the current one.
      if (!pendingFlush) pendingFlush = Promise.resolve().then(scheduleFlush);
      return;
    }
    if (!buffer.length) return;

    flushing = true;
    const batch = buffer.splice(0, buffer.length);
    try {
      await flush(batch);
      metrics.inc?.(`batcher_${name}_flushed_total`, batch.length);
    } catch (err) {
      metrics.inc?.(`batcher_${name}_errors_total`);
      logger.warn({ err, name, dropped: batch.length },
        'batcher flush failed — rows lost (use durable store for guarantees)');
    } finally {
      flushing = false;
      pendingFlush = null;
      if (buffer.length) scheduleFlush();
    }
  }

  function push(row) {
    if (buffer.length >= maxBufferSize) {
      // Drop OLDEST — newer rows are more useful (recency bias).
      const dropCount = Math.max(1, Math.floor(maxBufferSize * 0.10));
      buffer.splice(0, dropCount);
      droppedTotal += dropCount;
      metrics.inc?.(`batcher_${name}_dropped_total`, dropCount);
      if (onDrop) try { onDrop(dropCount); } catch {}
      logger.warn({ name, dropped: dropCount, total: droppedTotal },
        'batcher overflow — dropping oldest rows');
    }
    buffer.push(row);
    if (buffer.length >= maxBatch) _doFlush();
    else scheduleFlush();
  }

  async function drain() {
    while (buffer.length || flushing) {
      await _doFlush();
      if (flushing) await new Promise((r) => setTimeout(r, 10));
    }
  }

  function stats() {
    return { name, buffered: buffer.length, flushing, droppedTotal };
  }

  return { push, drain, stats };
}

module.exports = { makeBatcher };
