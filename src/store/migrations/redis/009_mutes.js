/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 009 — persistent mutes (v1.15.0). Redis flavour.
 *
 * Schemaless. Key layout (created lazily by redisStore.js v1.15.0+):
 *
 *   mutes:<chatJid>          HASH { <userJid>: <expiresAtSec> }
 *                             — for the active-check / hydration on boot
 *   mutes:log:<chatJid>      LIST of JSON entries (capped at 500 per chat)
 *                             — for the history view
 *
 * Active mutes auto-expire because the bot's TTL sweep removes them
 * from the HASH; the LIST keeps history.
 */
module.exports = {
  version: 9,
  description: 'persistent mutes log (v1.15.0) — Redis schemaless, no-op marker',

  async up(_ctx) {
    /* nothing to do */
  },
  async down(_ctx) {
    /* intentionally a no-op */
  },
};
