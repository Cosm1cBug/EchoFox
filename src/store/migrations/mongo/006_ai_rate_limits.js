/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 006 — persistent AI rate-limit counters (v1.3.0). Mongo flavour.
 *
 * Creates the compound + TTL indexes needed by mongoStore.js to upsert
 * counters by (jid, bucket) and lazy-expire via MongoDB TTL on expires_at.
 *
 * Note: TTL index requires expires_at as a Date. mongoStore.js stores it
 * as new Date(expiresAtMs) when writing.
 */
module.exports = {
  version: 6,
  description: 'AI persistent rate-limit counters (v1.3.0) — indexes',

  async up({ conn, logger }) {
    const specs = [
      ['ai_rate_user', { user_jid: 1, hour_bucket: 1 }, { unique: true }],
      ['ai_rate_chat', { chat_jid: 1, day_bucket: 1 }, { unique: true }],
      ['ai_rate_user', { expires_at: 1 }, { expireAfterSeconds: 0 }],
      ['ai_rate_chat', { expires_at: 1 }, { expireAfterSeconds: 0 }],
    ];
    for (const [coll, keys, opts] of specs) {
      try {
        await conn.collection(coll).createIndex(keys, opts);
      } catch (e) {
        if (logger?.warn) logger.warn({ coll, err: e.message }, 'index create failed (continuing)');
      }
    }
  },

  async down({ conn }) {
    for (const coll of ['ai_rate_user', 'ai_rate_chat']) {
      try {
        await conn.collection(coll).drop();
      } catch (_) {
        /* ignore */
      }
    }
  },
};
