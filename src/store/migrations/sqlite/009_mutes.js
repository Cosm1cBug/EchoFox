/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 009 — persistent mutes (v1.15.0). SQLite flavour.
 *
 *   mutes — append-on-mute / soft-expire log:
 *     chat_jid    group/chat where the mute applies
 *     user_jid    muted user
 *     created_at  unix seconds when the mute was placed
 *     expires_at  unix seconds when the mute should expire (or 0 = never; not used today)
 *     by_jid      admin who placed it (or null)
 *     reason      short text (≤ 200 chars)
 *     unmuted_at  unix seconds when the mute was manually cleared (or null = still active / expired naturally)
 *
 *   The schema is intentionally append-only — we record EVERY mute
 *   action as a row, even when the user has been muted before. This
 *   gives the dashboard a true "mute history" log per user.
 *
 *   The fast active-check uses the bot's in-memory cache; this table
 *   is for persistence + history view.
 */
module.exports = {
  version: 9,
  description: 'persistent mutes log (v1.15.0)',

  up({ db }) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mutes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_jid    TEXT    NOT NULL,
        user_jid    TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL,
        by_jid      TEXT,
        reason      TEXT,
        unmuted_at  INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_mutes_chat ON mutes (chat_jid, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mutes_user ON mutes (user_jid, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mutes_active ON mutes (expires_at) WHERE unmuted_at IS NULL;
    `);
  },

  down({ db }) {
    db.exec(`
      DROP INDEX IF EXISTS idx_mutes_active;
      DROP INDEX IF EXISTS idx_mutes_user;
      DROP INDEX IF EXISTS idx_mutes_chat;
      DROP TABLE IF EXISTS mutes;
    `);
  },
};
