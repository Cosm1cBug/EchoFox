/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 009 — persistent mutes (v1.15.0). Postgres flavour.
 *
 * Same logical schema as sqlite/009. Postgres allows the partial index
 * predicate to live in the CREATE INDEX statement (same as sqlite).
 */
module.exports = {
  version: 9,
  description: 'persistent mutes log (v1.15.0)',

  async up({ pool }) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mutes (
        id          BIGSERIAL PRIMARY KEY,
        chat_jid    TEXT      NOT NULL,
        user_jid    TEXT      NOT NULL,
        created_at  BIGINT    NOT NULL,
        expires_at  BIGINT    NOT NULL,
        by_jid      TEXT,
        reason      TEXT,
        unmuted_at  BIGINT
      );
      CREATE INDEX IF NOT EXISTS idx_mutes_chat ON mutes (chat_jid, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mutes_user ON mutes (user_jid, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mutes_active ON mutes (expires_at) WHERE unmuted_at IS NULL;
    `);
  },

  async down({ pool }) {
    await pool.query(`
      DROP INDEX IF EXISTS idx_mutes_active;
      DROP INDEX IF EXISTS idx_mutes_user;
      DROP INDEX IF EXISTS idx_mutes_chat;
      DROP TABLE IF EXISTS mutes;
    `);
  },
};
