/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 007 — per-user XP/level tracking (v1.12.0). SQLite flavour.
 *
 *   user_levels stores cumulative XP per user JID. Level is derived
 *   from xp at read-time (no need to store level — it'd just be a
 *   denormalised duplicate that could drift).
 *
 * Idempotent.
 */
module.exports = {
  version: 7,
  description: 'user_levels for per-user XP tracking (v1.12.0)',

  up({ db }) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_levels (
        jid      TEXT    PRIMARY KEY,
        xp       INTEGER NOT NULL DEFAULT 0,
        last_at  INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_user_levels_xp ON user_levels (xp);
    `);
  },

  down({ db }) {
    db.exec(`
      DROP INDEX IF EXISTS idx_user_levels_xp;
      DROP TABLE IF EXISTS user_levels;
    `);
  },
};
