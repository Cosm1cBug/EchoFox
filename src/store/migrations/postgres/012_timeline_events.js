/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 012 — generic change timeline (v1.21.0, dashboard history views).
 * Same logical change as sqlite/012. Postgres flavour.
 */
module.exports = {
  version: 12,
  description: 'timeline_events generic change log (dashboard history views)',

  async up({ pool }) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS timeline_events (
        id         BIGSERIAL PRIMARY KEY,
        domain     TEXT NOT NULL,
        entity_id  TEXT,
        field      TEXT,
        old_value  TEXT,
        new_value  TEXT,
        actor      TEXT,
        source     TEXT,
        ts         BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timeline_domain_ts ON timeline_events (domain, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_timeline_entity_ts ON timeline_events (domain, entity_id, ts DESC);
    `);
  },

  async down(_ctx) {
    // No-op. Dropping the timeline would lose history for no benefit.
  },
};
