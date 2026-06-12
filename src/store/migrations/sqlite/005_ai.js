/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 005 — AI conversation memory + usage + opt-in (v1.2.0). SQLite flavour.
 *
 * Tables:
 *   • ai_conversations   — append-only per-chat turn log
 *                          (role: 'user'|'assistant'|'tool'|'system', tokens, model, ts)
 *   • ai_usage_daily     — daily token + USD-cost rollup per provider/model
 *   • ai_chat_opt_in     — per-chat enabled flag + per-chat overrides
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS only.
 */
module.exports = {
  version: 5,
  description: 'AI memory + usage + opt-in (v1.2.0)',

  up({ db }) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_jid    TEXT    NOT NULL,
        role        TEXT    NOT NULL,
        content     TEXT    NOT NULL,
        tool_name   TEXT,
        tool_args   TEXT,
        tool_id     TEXT,
        model       TEXT,
        provider    TEXT,
        prompt_tokens     INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        ts          INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_conv_chat_ts ON ai_conversations (chat_jid, ts);

      CREATE TABLE IF NOT EXISTS ai_usage_daily (
        day               TEXT    NOT NULL,
        provider          TEXT    NOT NULL,
        model             TEXT    NOT NULL,
        prompt_tokens     INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd          REAL    NOT NULL DEFAULT 0,
        calls             INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, provider, model)
      );

      CREATE TABLE IF NOT EXISTS ai_chat_opt_in (
        chat_jid      TEXT    PRIMARY KEY,
        enabled       INTEGER NOT NULL DEFAULT 0,
        persona       TEXT,
        provider      TEXT,
        model         TEXT,
        updated_at    INTEGER NOT NULL
      );
    `);
  },

  down({ db }) {
    db.exec(`
      DROP TABLE IF EXISTS ai_chat_opt_in;
      DROP TABLE IF EXISTS ai_usage_daily;
      DROP TABLE IF EXISTS ai_conversations;
    `);
  },
};
