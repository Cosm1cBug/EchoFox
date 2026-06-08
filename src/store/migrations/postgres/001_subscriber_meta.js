/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v0.4.7 — extend service_subscribers with a meta JSONB column.
 *
 * Mirrors the sqlite/001 migration. ADD COLUMN IF NOT EXISTS is
 * intrinsically idempotent in Postgres ≥ 9.6.
 */
module.exports = {
  version: 1,
  description: 'add service_subscribers.meta JSONB column',

  async up({ pool }) {
    await pool.query(`
      ALTER TABLE service_subscribers
        ADD COLUMN IF NOT EXISTS meta JSONB
    `);
  },

  async down(_ctx) { /* intentionally a no-op */ },
};