/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 006 — persistent AI rate-limit counters (v1.3.0). SQLite flavour.
 *
 * Replaces the in-memory router._userHour / _chatDay Maps with store
 * tables so counters survive restarts.
 *
 * Tables:
 *   ai_rate_user   (user_jid, hour_bucket)         -> count, expires_at
 *   ai_rate_chat   (chat_jid, day_bucket)          -> count, expires_at
 *
 * hour_bucket = floor(now_ms / 3_600_000)
 * day_bucket  = floor(now_ms / 86_400_000)
 *
 * expires_at = (bucket+2) * window_ms   — kept 1 bucket past end for
 * lazy prune via DELETE WHERE expires_at < ?.
 *
 * Idempotent.
 */
module.exports = {
  version: 6,
  description: 'AI persistent rate-limit counters (v1.3.0)',

  up({ db }) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_rate_user (
        user_jid    TEXT    NOT NULL,
        hour_bucket INTEGER NOT NULL,
        count       INTEGER NOT NULL DEFAULT 0,
        expires_at  INTEGER NOT NULL,
        PRIMARY KEY (user_jid, hour_bucket)
      );
      CREATE INDEX IF NOT EXISTS idx_ai_rate_user_exp ON ai_rate_user (expires_at);

      CREATE TABLE IF NOT EXISTS ai_rate_chat (
        chat_jid    TEXT    NOT NULL,
        day_bucket  INTEGER NOT NULL,
        count       INTEGER NOT NULL DEFAULT 0,
        expires_at  INTEGER NOT NULL,
        PRIMARY KEY (chat_jid, day_bucket)
      );
      CREATE INDEX IF NOT EXISTS idx_ai_rate_chat_exp ON ai_rate_chat (expires_at);
    `);
  },

  down({ db }) {
    db.exec(`
      DROP TABLE IF EXISTS ai_rate_chat;
      DROP TABLE IF EXISTS ai_rate_user;
    `);
  },
};
