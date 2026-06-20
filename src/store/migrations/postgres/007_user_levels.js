/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 007 — per-user XP/level tracking (v1.12.0). Postgres flavour.
 *
 * Same logical schema as sqlite/007.
 */
module.exports = {
  version: 7,
  description: 'user_levels for per-user XP tracking (v1.12.0)',

  async up({ pool }) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_levels (
        jid      TEXT    PRIMARY KEY,
        xp       BIGINT  NOT NULL DEFAULT 0,
        last_at  BIGINT  NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_user_levels_xp ON user_levels (xp);
    `);
  },

  async down({ pool }) {
    await pool.query(`
      DROP INDEX IF EXISTS idx_user_levels_xp;
      DROP TABLE IF EXISTS user_levels;
    `);
  },
};
