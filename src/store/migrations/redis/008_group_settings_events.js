/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 008 — group settings event log (v1.14.0). Redis flavour.
 *
 * Schemaless. Key layout (created lazily by redisStore.js v1.14.0+):
 *
 *   group_settings_events:<groupJid>   LIST of JSON-serialised events
 *                                       (newest pushed to the LEFT,
 *                                        capped at MAX_EVENTS_PER_GROUP
 *                                        via LTRIM after each LPUSH).
 *
 * Each event is a JSON object: { field, old_value, new_value, actor, ts }.
 */
module.exports = {
  version: 8,
  description: 'group settings event log (v1.14.0) — Redis schemaless, no-op marker',

  async up(_ctx) {
    /* nothing to do */
  },
  async down(_ctx) {
    /* intentionally a no-op */
  },
};
