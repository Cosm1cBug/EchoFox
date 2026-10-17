/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 011 — message-capping info column (v1.20.0, event fix E5).
 *
 * Same logical change as sqlite/011: `message_capping.info` (JSONB-free
 * TEXT for parity) holds the full account-level NewChatMessageCapInfo from
 * the `message-capping.update` event. Postgres flavour.
 */
module.exports = {
  version: 11,
  description: 'message_capping.info JSON column (account quota, v1.20.0)',

  async up({ pool }) {
    await pool.query(`
      ALTER TABLE message_capping ADD COLUMN IF NOT EXISTS info TEXT
    `);
  },

  async down(_ctx) {
    // No-op. Dropping the column would lose quota history for no benefit.
  },
};
