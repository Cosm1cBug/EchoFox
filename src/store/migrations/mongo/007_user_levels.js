/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 007 — per-user XP/level tracking (v1.12.0). Mongo flavour.
 *
 * Creates a unique index on jid + a non-unique index on xp for any
 * future leaderboard sorting (currently unused — leveling is
 * .profile-only, not leaderboard, by design).
 */
module.exports = {
  version: 7,
  description: 'user_levels for per-user XP tracking (v1.12.0) — indexes',

  async up({ conn, logger }) {
    const specs = [
      ['user_levels', { jid: 1 }, { unique: true }],
      ['user_levels', { xp: -1 }, {}],
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
    try {
      await conn.collection('user_levels').drop();
    } catch (_) {
      /* ignore */
    }
  },
};
