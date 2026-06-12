/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 005 — AI conversation memory + usage + opt-in (v1.2.0). Postgres flavour.
 *
 * Same logical schema as sqlite/005; uses BIGINT for ms timestamps, NUMERIC for cost,
 * JSONB for opt-in overrides.
 */
module.exports = {
  version: 5,
  description: 'AI memory + usage + opt-in (v1.2.0)',

  async up({ pool }) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id          BIGSERIAL PRIMARY KEY,
        chat_jid    TEXT    NOT NULL,
        role        TEXT    NOT NULL,
        content     TEXT    NOT NULL,
        tool_name   TEXT,
        tool_args   TEXT,
        tool_id     TEXT,
        model       TEXT,
        provider    TEXT,
        prompt_tokens     INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        ts          BIGINT  NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_conv_chat_ts ON ai_conversations (chat_jid, ts);

      CREATE TABLE IF NOT EXISTS ai_usage_daily (
        day               TEXT    NOT NULL,
        provider          TEXT    NOT NULL,
        model             TEXT    NOT NULL,
        prompt_tokens     INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd          NUMERIC(14,6) NOT NULL DEFAULT 0,
        calls             INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, provider, model)
      );

      CREATE TABLE IF NOT EXISTS ai_chat_opt_in (
        chat_jid    TEXT    PRIMARY KEY,
        enabled     BOOLEAN NOT NULL DEFAULT false,
        overrides   JSONB   NOT NULL DEFAULT '{}'::jsonb,
        updated_at  BIGINT  NOT NULL
      );
    `);
  },

  async down({ pool }) {
    await pool.query(`
      DROP TABLE IF EXISTS ai_chat_opt_in;
      DROP TABLE IF EXISTS ai_usage_daily;
      DROP TABLE IF EXISTS ai_conversations;
    `);
  },
};
