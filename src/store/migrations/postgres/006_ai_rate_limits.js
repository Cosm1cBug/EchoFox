/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 006 — persistent AI rate-limit counters (v1.3.0). Postgres flavour.
 *
 * Same logical schema as sqlite/006; uses BIGINT for ms-scale buckets
 * and expires_at.
 */
module.exports = {
  version: 6,
  description: 'AI persistent rate-limit counters (v1.3.0)',

  async up({ pool }) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_rate_user (
        user_jid    TEXT    NOT NULL,
        hour_bucket BIGINT  NOT NULL,
        count       INTEGER NOT NULL DEFAULT 0,
        expires_at  BIGINT  NOT NULL,
        PRIMARY KEY (user_jid, hour_bucket)
      );
      CREATE INDEX IF NOT EXISTS idx_ai_rate_user_exp ON ai_rate_user (expires_at);

      CREATE TABLE IF NOT EXISTS ai_rate_chat (
        chat_jid    TEXT    NOT NULL,
        day_bucket  BIGINT  NOT NULL,
        count       INTEGER NOT NULL DEFAULT 0,
        expires_at  BIGINT  NOT NULL,
        PRIMARY KEY (chat_jid, day_bucket)
      );
      CREATE INDEX IF NOT EXISTS idx_ai_rate_chat_exp ON ai_rate_chat (expires_at);
    `);
  },

  async down({ pool }) {
    await pool.query(`
      DROP TABLE IF EXISTS ai_rate_chat;
      DROP TABLE IF EXISTS ai_rate_user;
    `);
  },
};
