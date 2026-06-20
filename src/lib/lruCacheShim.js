/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * lruCacheShim — thin wrapper around `lru-cache` that exposes the
 * NodeCache-compatible methods our code (and Baileys) call.
 *
 * Why this exists:
 *   We used to mix `node-cache` (TTL-only API) and `lru-cache` (size+TTL
 *   API) in src/core/caches.js. v1.12.0 consolidates the
 *   APP-INTERNAL caches (`profilePicCache`, `parseCache`) onto
 *   `lru-cache` to drop the `node-cache` runtime dep for those, while
 *   keeping the 5 Baileys-facing caches on `node-cache` (those have
 *   stricter API requirements — `await get/set/del` + optional
 *   `mget/mset` + `close()` — that node-cache satisfies natively).
 *
 *   The shim makes the LRU look like a NodeCache for the migration's
 *   callers, so consumers of `profilePicCache` and `parseCache`
 *   don't notice the swap.
 *
 * API surface (NodeCache-compatible):
 *   .get(key)          → value | undefined
 *   .set(key, value)   → true
 *   .del(key) / .delete(key) → boolean (was-present)
 *   .has(key)          → boolean
 *   .flushAll() / .clear() → undefined
 *   .keys()            → string[]
 *   .size              → number  (getter, NOT a method — both spellings work)
 *   .getStats()        → { keys: <count> }   (minimal compat with diagnostics)
 *
 * NOT exposed (intentionally — these are Baileys hot-paths that still
 * use node-cache for now):
 *   .mget()  .mset()  .take()  .close()  .on()
 */

const { LRUCache } = require('lru-cache');

class LruCacheShim {
  /**
   * @param {object} opts
   * @param {number} opts.max               — max entries (default 1000)
   * @param {number} [opts.ttl]             — TTL in ms (omit for size-only LRU)
   * @param {number} [opts.stdTTL]          — NodeCache-style TTL in SECONDS, converted to ms
   * @param {boolean} [opts.updateAgeOnGet] — passed to LRUCache (default false)
   * @param {boolean} [opts.useClones]      — IGNORED (NodeCache compat — we never clone)
   */
  constructor(opts = {}) {
    const max = Number.isInteger(opts.max) && opts.max > 0 ? opts.max : 1000;
    // Support both NodeCache (stdTTL in seconds) and LRUCache (ttl in ms) styles.
    let ttlMs;
    if (typeof opts.ttl === 'number' && opts.ttl > 0) {
      ttlMs = opts.ttl;
    } else if (typeof opts.stdTTL === 'number' && opts.stdTTL > 0) {
      ttlMs = opts.stdTTL * 1000;
    }
    this._lru = new LRUCache({
      max,
      ...(ttlMs ? { ttl: ttlMs } : {}),
      updateAgeOnGet: !!opts.updateAgeOnGet,
    });
  }

  /* ─── NodeCache-style API ─────────────────────────────────────── */

  get(key) {
    return this._lru.get(key);
  }

  set(key, value) {
    this._lru.set(key, value);
    return true; // NodeCache returns true on set
  }

  del(key) {
    return this.delete(key);
  }

  delete(key) {
    return this._lru.delete(key);
  }

  has(key) {
    return this._lru.has(key);
  }

  flushAll() {
    this._lru.clear();
  }

  clear() {
    this._lru.clear();
  }

  keys() {
    return [...this._lru.keys()];
  }

  /** Compatibility with diagnostics.js — returns a NodeCache-shaped stats object. */
  getStats() {
    return { keys: this._lru.size };
  }

  /** LRU-style `.size` is a getter, NOT a method. Expose both shapes. */
  get size() {
    return this._lru.size;
  }
}

module.exports = { LruCacheShim };
