/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v0.4.7 — extend service_subscribers with a meta JSON column.
 *
 * Stores per-subscriber metadata: topics (for filtered feeds), delivery
 * preferences (locale, hour-windows), and future extensibility.
 *
 * Idempotent: PRAGMA-checked column add.
 */
module.exports = {
  version: 1,
  description: 'add service_subscribers.meta JSON column',

  up({ db }) {
    const cols = db
      .prepare(`PRAGMA table_info(service_subscribers)`)
      .all()
      .map((c) => c.name);
    if (!cols.includes('meta')) {
      db.exec(`ALTER TABLE service_subscribers ADD COLUMN meta TEXT`);
    }
  },

  down(_ctx) {
    /* intentionally a no-op — we don't drop the column */
  },
};
