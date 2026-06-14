/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 005 — AI memory + usage + opt-in (v1.2.0). Redis flavour.
 *
 * Redis is schemaless. Key layouts used by redisStore.js (Group D adds methods):
 *
 *   ai_conv:<chat_jid>            LIST   per-chat conversation turns (JSON-encoded)
 *                                        capped to config.ai.memoryTurns × 4 entries on push
 *   ai_usage:<YYYY-MM-DD>         HASH   { "<provider>:<model>" → JSON{prompt,completion,cost,calls} }
 *   ai_opt_in:<chat_jid>          STRING JSON{enabled, persona?, provider?, model?, updatedAt}
 *   ai_rate_user:<jid>:<hour_bucket>     STRING counter, EXPIREAT 1h boundary
 *   ai_rate_chat:<jid>:<day>             STRING counter, EXPIREAT day boundary
 *
 * No-op marker — keys are created lazily.
 */
module.exports = {
  version: 5,
  description: 'AI memory + usage + opt-in (v1.2.0) — Redis schemaless, no-op marker',

  async up(_ctx) {
    /* nothing to do */
  },
  async down(_ctx) {
    /* intentionally a no-op */
  },
};
