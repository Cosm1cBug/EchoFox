/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 004 — extended event persistence (v1.1.0). MongoDB flavour.
 *
 * Collections are declared inside mongoStore.js as mongoose models and
 * auto-created on first write. This migration ensures the indexes for
 * the new collections (blocklist, presence, labels, label_associations,
 * newsletters, newsletter_views, newsletter_reactions, newsletter_settings,
 * lid_mapping, message_capping) are explicitly created at migrate-time
 * so query patterns are fast from the first write.
 */
module.exports = {
  version: 4,
  description: 'extended event persistence — ensure indexes for new collections',

  async up({ conn, logger }) {
    const indexes = [
      ['blocklist',              { jid: 1 },               { unique: true }],
      ['presence',               { jid: 1 },               { unique: true }],
      ['presence',               { chat_jid: 1 },          {}],
      ['presence',               { updated_at: -1 },       {}],
      ['labels',                 { label_id: 1 },          { unique: true }],
      ['label_associations',     { label_id: 1, target_type: 1, target_jid: 1, target_msg_id: 1 }, { unique: true }],
      ['label_associations',     { target_jid: 1 },        {}],
      ['newsletters',            { newsletter_id: 1 },     { unique: true }],
      ['newsletter_views',       { newsletter_id: 1, message_id: 1 }, { unique: true }],
      ['newsletter_reactions',   { newsletter_id: 1, message_id: 1 }, {}],
      ['newsletter_settings',    { newsletter_id: 1 },     { unique: true }],
      ['lid_mapping',            { lid: 1 },               { unique: true }],
      ['lid_mapping',            { jid: 1 },               {}],
      ['message_capping',        { jid: 1 },               { unique: true }],
    ];

    for (const [coll, keys, opts] of indexes) {
      try {
        await conn.collection(coll).createIndex(keys, opts);
      } catch (e) {
        logger?.warn?.({ err: e, coll, keys }, 'index creation noop (likely already exists)');
      }
    }
  },

  async down(_ctx) { /* intentionally a no-op */ },
};