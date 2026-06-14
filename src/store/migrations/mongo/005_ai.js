/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 005 — AI conversation memory + usage + opt-in (v1.2.0). Mongo flavour.
 *
 * Mongo is schemaless; this migration creates indexes that match the access
 * patterns used by mongoStore.js (Group D adds the matching methods).
 */
module.exports = {
  version: 5,
  description: 'AI memory + usage + opt-in (v1.2.0) — indexes',

  async up({ conn, logger }) {
    const indexes = [
      ['ai_conversations', { chat_jid: 1, ts: 1 }, {}],
      ['ai_usage_daily', { day: 1, provider: 1, model: 1 }, { unique: true }],
      ['ai_chat_opt_in', { chat_jid: 1 }, { unique: true }],
      ['ai_rate_user', { user_jid: 1, hour_bucket: 1 }, { unique: true }],
    ];
    for (const [coll, keys, opts] of indexes) {
      try {
        await conn.collection(coll).createIndex(keys, opts);
      } catch (e) {
        if (logger?.warn) logger.warn({ coll, err: e.message }, 'index create failed (continuing)');
      }
    }
  },

  async down({ conn }) {
    for (const coll of ['ai_conversations', 'ai_usage_daily', 'ai_chat_opt_in', 'ai_rate_user']) {
      try {
        await conn.collection(coll).drop();
      } catch (_) {
        /* ignore */
      }
    }
  },
};
