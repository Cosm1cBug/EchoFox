/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v0.4.7 — rename thehackersnews_sent_articles → service_sent_items.
 *
 *   The table was always polymorphic (its first column is `service`),
 *   the THN-prefixed name was a historical accident. Phase 6 introduces
 *   3 more services that need item-dedup; rename now while it's still
 *   one caller.
 *
 *   Idempotent: skip the rename if the old name doesn't exist OR the
 *   new name already exists. Data preserved.
 */
module.exports = {
  version: 2,
  description: 'rename thehackersnews_sent_articles → service_sent_items',

  up({ db }) {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
    const oldExists = tables.includes('thehackersnews_sent_articles');
    const newExists = tables.includes('service_sent_items');
    if (newExists) return;          // already migrated
    if (!oldExists) {
      // Fresh install: just create with new name (inline DDL also does this)
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_sent_items (
          service     TEXT NOT NULL,
          jid         TEXT NOT NULL,
          item_url    TEXT NOT NULL,
          sent_at     INTEGER NOT NULL,
          PRIMARY KEY (service, jid, item_url)
        );`);
      return;
    }
    // Rename in place — preserves all rows
    db.exec(`ALTER TABLE thehackersnews_sent_articles RENAME TO service_sent_items;`);
    // Column rename: article_url → item_url
    db.exec(`ALTER TABLE service_sent_items RENAME COLUMN article_url TO item_url;`);
  },

  down(_ctx) { /* intentionally a no-op — we don't roll back renames */ },
};