/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Baseline migration for the MongoDB store.
 *
 * Mongo collections + indexes are declared idempotently inside
 * mongoStore.js (via mongoose.model + .index()). This migration exists
 * primarily so the _migrations tracking collection has a v=0 marker —
 * keeping the tracking scheme consistent across backends.
 *
 * If future schema changes require ad-hoc operations (e.g. backfilling
 * a new field, dropping a deprecated collection), add them as
 * 001_<slug>.js / 002_<slug>.js. They run sequentially, fail-fast on
 * error, and are recorded in the `_migrations` collection.
 */
module.exports = {
  version: 0,
  description: 'baseline — mongoose model auto-creates collections + indexes',

  async up({ conn, logger }) {
    // Ensure the tracking collection has its unique index (runner does
    // this in ensure(), but we double-check here for visibility).
    try {
      await conn.collection('_migrations').createIndex({ version: 1 }, { unique: true });
    } catch (e) {
      logger?.warn?.({ err: e }, 'mongo baseline: index creation noop');
    }
  },

  async down(_ctx) {
    /* intentionally a no-op */
  },
};
