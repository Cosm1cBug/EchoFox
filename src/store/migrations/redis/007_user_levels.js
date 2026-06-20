/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 007 — per-user XP/level tracking (v1.12.0). Redis flavour.
 *
 * Schemaless. Key layout (created lazily by redisStore.js v1.12.0+):
 *
 *   user_levels:<userJid>   HASH { xp: <number>, last_at: <unix-seconds> }
 *
 * No TTL — leveling is permanent (cleared only by explicit user reset).
 */
module.exports = {
  version: 7,
  description: 'user_levels per-user XP tracking (v1.12.0) — Redis schemaless, no-op marker',

  async up(_ctx) {
    /* nothing to do */
  },
  async down(_ctx) {
    /* intentionally a no-op */
  },
};
