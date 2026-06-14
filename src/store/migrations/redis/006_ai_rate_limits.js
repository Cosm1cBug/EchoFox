/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 006 — persistent AI rate-limit counters (v1.3.0). Redis flavour.
 *
 * Schemaless. Key layouts (created lazily by redisStore.js v1.3.0+):
 *
 *   ai_rate_user:<userJid>:<hourBucket>   STRING counter, EXPIREAT (bucket+2)*3600
 *   ai_rate_chat:<chatJid>:<dayBucket>    STRING counter, EXPIREAT (bucket+2)*86400
 *
 * Redis handles expiry natively; no scheduled prune needed.
 */
module.exports = {
  version: 6,
  description: 'AI persistent rate-limit counters (v1.3.0) — Redis schemaless, no-op marker',

  async up(_ctx) {
    /* nothing to do */
  },
  async down(_ctx) {
    /* intentionally a no-op */
  },
};
