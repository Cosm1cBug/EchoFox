/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';
/**
 * Per-sender token-bucket rate limiter.
 * Used to throttle command abuse and protect outbound WA traffic
 * (WhatsApp will rate-limit / ban hot senders).
 *
 *   const rl = makeRateLimiter({ capacity: 10, refillPerSec: 1 });
 *   if (!rl.tryConsume(jid)) return ctx.reply('⏱️ Slow down a bit.');
 */
const { LRUCache } = require('lru-cache');

function makeRateLimiter({ capacity = 10, refillPerSec = 1, ttlMs = 60_000 } = {}) {
  const buckets = new LRUCache({ max: 100_000, ttl: ttlMs });

  return {
    tryConsume(key, cost = 1) {
      const now = Date.now();
      let b = buckets.get(key);
      if (!b) {
        b = { tokens: capacity, ts: now };
        buckets.set(key, b);
      }

      const elapsedS = (now - b.ts) / 1000;
      b.tokens = Math.min(capacity, b.tokens + elapsedS * refillPerSec);
      b.ts = now;

      if (b.tokens < cost) return false;
      b.tokens -= cost;
      return true;
    },
    reset(key) {
      buckets.delete(key);
    },
    size: () => buckets.size,
  };
}

module.exports = { makeRateLimiter };
