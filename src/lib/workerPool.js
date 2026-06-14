/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Generic round-robin worker_threads pool.
 *
 *   const pool = new WorkerPool({
 *     script: path.resolve('./src/workers/mediaWorker.js'),
 *     size: 2,
 *     defaultTimeoutMs: 90_000,
 *   });
 *
 *   const result = await pool.run({ op: 'sticker', buf, opts });
 *
 *   pool.size          — current alive worker count
 *   pool.queueDepth    — jobs waiting for a worker
 *   pool.shutdown()    — graceful drain + terminate
 *
 *   • Each job gets a unique id; correlates the worker's response back
 *     to the right caller (workers can interleave async ops).
 *   • Round-robin scheduling — simple and fair for CPU-equal jobs.
 *   • Per-job timeout: if the worker doesn't respond in time we reject
 *     the promise AND respawn that worker (it's presumably wedged).
 *   • Workers that crash are auto-respawned (max 5 respawns/min/worker).
 *   • Jobs in flight when a worker dies are rejected with `EWORKERDIED`.
 */

const { Worker } = require('node:worker_threads');
const logger = require('../core/logger').child({ mod: 'workerPool' });

let _seq = 0;
function nextId() {
  return ++_seq;
}

class WorkerSlot {
  constructor(pool, index) {
    this.pool = pool;
    this.index = index;
    this.worker = null;
    this.inflight = new Map(); // jobId → { resolve, reject, timer, label }
    this.respawnHits = []; // timestamps; capped 5/min
    this._spawn();
  }

  _spawn() {
    this.worker = new Worker(this.pool.script, {
      workerData: { index: this.index },
    });

    this.worker.on('message', (msg) => {
      const entry = this.inflight.get(msg.id);
      if (!entry) return;
      this.inflight.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        const err = new Error(msg.error.message || 'worker error');
        Object.assign(err, msg.error);
        entry.reject(err);
      } else {
        entry.resolve(msg.result);
      }
    });

    this.worker.on('error', (err) => {
      logger.warn({ workerIndex: this.index, err }, 'worker emitted error');
      this._failAllInflight('EWORKERERR', err);
    });

    this.worker.on('exit', (code) => {
      const wasGraceful = this.pool._shuttingDown;
      logger.warn({ workerIndex: this.index, code, wasGraceful }, 'worker exited');
      this._failAllInflight('EWORKERDIED', new Error(`worker exited code=${code}`));
      if (wasGraceful) return;

      // Rate-limit respawns
      const now = Date.now();
      this.respawnHits = this.respawnHits.filter((t) => now - t < 60_000);
      if (this.respawnHits.length >= 5) {
        logger.error(
          { workerIndex: this.index },
          'too many respawns in last minute — leaving worker dead until pool restart',
        );
        this.worker = null;
        return;
      }
      this.respawnHits.push(now);
      logger.info({ workerIndex: this.index }, 'respawning worker');
      this._spawn();
    });
  }

  _failAllInflight(code, err) {
    for (const [, entry] of this.inflight) {
      clearTimeout(entry.timer);
      const wrapped = new Error(`${code}: ${err?.message || 'unknown'}`);
      wrapped.code = code;
      entry.reject(wrapped);
    }
    this.inflight.clear();
  }

  isAlive() {
    return !!this.worker;
  }
  get depth() {
    return this.inflight.size;
  }

  send(payload, timeoutMs) {
    if (!this.worker) {
      return Promise.reject(Object.assign(new Error('worker is dead'), { code: 'EWORKERDEAD' }));
    }
    return new Promise((resolve, reject) => {
      const id = nextId();
      const timer = setTimeout(() => {
        this.inflight.delete(id);
        const e = new Error(`worker job ${payload.op || '?'} timed out after ${timeoutMs}ms`);
        e.code = 'ETIMEDOUT';
        reject(e);
        // Suspect this worker is wedged — terminate so it respawns.
        try {
          this.worker.terminate().catch(() => {});
        } catch {}
      }, timeoutMs).unref();

      this.inflight.set(id, { resolve, reject, timer, label: payload.op });
      try {
        this.worker.postMessage({ id, ...payload });
      } catch (e) {
        clearTimeout(timer);
        this.inflight.delete(id);
        reject(e);
      }
    });
  }

  async terminate() {
    try {
      if (this.worker) await this.worker.terminate();
    } catch {}
    this.worker = null;
  }
}

class WorkerPool {
  constructor({ script, size = 2, defaultTimeoutMs = 60_000 }) {
    if (!script) throw new Error('WorkerPool: script path required');
    this.script = script;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this._shuttingDown = false;
    this._rr = 0;
    this.slots = Array.from({ length: Math.max(1, size) }, (_, i) => new WorkerSlot(this, i));
    logger.info({ size: this.slots.length, script }, 'worker pool started');
  }

  get size() {
    return this.slots.filter((s) => s.isAlive()).length;
  }
  get queueDepth() {
    return this.slots.reduce((a, s) => a + s.depth, 0);
  }

  /**
   * Run a job on the least-busy alive worker. Falls back to round-robin
   * when ties / all idle.
   */
  run(payload, opts = {}) {
    const aliveSlots = this.slots.filter((s) => s.isAlive());
    if (!aliveSlots.length) {
      return Promise.reject(Object.assign(new Error('no alive workers'), { code: 'ENOWORKERS' }));
    }

    // Pick the slot with fewest inflight jobs; tie-break round-robin
    aliveSlots.sort((a, b) => a.depth - b.depth);
    const least = aliveSlots[0];
    const candidates = aliveSlots.filter((s) => s.depth === least.depth);
    const chosen = candidates[this._rr++ % candidates.length];

    return chosen.send(payload, opts.timeoutMs || this.defaultTimeoutMs);
  }

  async shutdown() {
    this._shuttingDown = true;
    logger.info({ inflight: this.queueDepth }, 'shutting down worker pool');
    await Promise.all(this.slots.map((s) => s.terminate()));
  }
}

module.exports = { WorkerPool };
