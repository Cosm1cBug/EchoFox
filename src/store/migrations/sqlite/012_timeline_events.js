/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 012 — generic change timeline (v1.21.0, dashboard history views).
 *
 * One append-only log for every state-change that previously only overwrote
 * its snapshot row (presence, contacts, chats, blocklist, labels,
 * newsletters, subscriptions, settings, calls, connection, xp, metrics…).
 * Powers GET /api/history/:domain and the per-page HistoryPanel.
 *
 * Columns: domain (required), entity_id, field, old_value, new_value,
 * actor, source, ts. Idempotent: CREATE TABLE IF NOT EXISTS.
 */
module.exports = {
  version: 12,
  description: 'timeline_events generic change log (dashboard history views)',

  up({ db }) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS timeline_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        domain     TEXT NOT NULL,
        entity_id  TEXT,
        field      TEXT,
        old_value  TEXT,
        new_value  TEXT,
        actor      TEXT,
        source     TEXT,
        ts         INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timeline_domain_ts ON timeline_events (domain, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_timeline_entity_ts ON timeline_events (domain, entity_id, ts DESC);
    `);
  },

  down(_ctx) {
    // No-op. Dropping the timeline would lose history for no benefit.
  },
};
