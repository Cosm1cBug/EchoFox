/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 004 — extended event persistence (v1.1.0). Redis flavour.
 *
 * Redis is schemaless. The new key layouts (used by redisStore.js v1.1.0+):
 *
 *   blocklist:                 SET   blocklist        — JIDs in the blocklist
 *   presence:                  HASH  presence:<jid>   — { state, last_seen_ts, chat_jid, updated_at }
 *   labels:                    HASH  label:<id>       — { name, color, deleted, updated_at }
 *   label_associations:        SET   label_assoc:<labelId>:<targetType> — members are "<jid>|<msgId>"
 *   newsletters:               HASH  newsletter:<id>  — full metadata
 *   newsletter_views:          HASH  nl_views:<id>    — { <msgId>: viewCount }
 *   newsletter_reactions:      LIST  nl_react:<id>:<msgId> — append-only emoji|count|ts
 *   newsletter_settings:       STRING nl_settings:<id> — JSON-encoded settings
 *   lid_mapping:               HASH  lid_map          — { lid → jid, lid → jid, ... }
 *   message_capping:           HASH  msg_cap          — { jid → capValue }
 *
 * This migration is a no-op marker — all keys are created lazily by
 * redisStore.js on first write.
 */
module.exports = {
  version: 4,
  description: 'extended event persistence — Redis is schemaless, no-op marker',

  async up(_ctx) {
    /* nothing to do */
  },
  async down(_ctx) {
    /* intentionally a no-op */
  },
};
