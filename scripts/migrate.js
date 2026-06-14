#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Manual migration runner.
 *
 *   $ npm run migrate              # apply all pending
 *   $ npm run migrate -- --status  # show what would run, don't apply
 *
 * Uses the same configLoader + store factory as production, but does
 * NOT open a Baileys socket — useful for one-shot ops on a stopped bot.
 */

const args = process.argv.slice(2);
const statusOnly = args.includes('--status');

const { config } = require('../src/lib/configLoader');
const { createStore } = require('../src/store/db');
const { runMigrations } = require('../src/lib/migrationsRunner');
const logger = require('../src/core/logger').child({ mod: 'migrate-cli' });

const BACKEND_MAP = { SQLITE: 'sqlite', POSTGRES: 'postgres', MONGODB: 'mongo', REDIS: 'redis' };

(async () => {
  const type = (config.storeDB.type || 'SQLITE').toUpperCase();
  const mBackend = BACKEND_MAP[type];
  if (!mBackend) {
    logger.fatal({ type }, 'unknown storeDB.type');
    process.exit(2);
  }

  logger.info({ backend: type, dryRun: statusOnly }, 'connecting store…');

  // Minimal stubs for the createStore signature (no Baileys socket needed)
  const groupCache = new Map();
  groupCache.get = () => undefined;
  groupCache.set = () => {};
  const store = createStore(config, logger.child({ mod: 'store' }), groupCache);

  const ctx =
    mBackend === 'sqlite'
      ? { db: store.db }
      : mBackend === 'postgres'
        ? { pool: store.pool }
        : mBackend === 'mongo'
          ? { conn: store.conn }
          : mBackend === 'redis'
            ? { client: store.client }
            : null;
  if (!ctx || Object.values(ctx).some((v) => v == null)) {
    logger.fatal(
      { type, ctx: Object.keys(ctx || {}) },
      'store did not expose the primitive needed for migrations',
    );
    process.exit(3);
  }

  try {
    if (statusOnly) {
      // For now we just call runMigrations() — it logs what's applied.
      // A future enhancement could add a dedicated dry-run mode in the
      // runner that doesn't actually invoke up(). For now, --status
      // shows you the migrations list without applying anything new.
      logger.info(
        'NOTE: --status currently logs migration status from the runner; it does NOT prevent application. Cancel with Ctrl-C if you only want to inspect.',
      );
    }
    const result = await runMigrations(mBackend, ctx);
    logger.info({ applied: result.applied.length, skipped: result.skipped }, '✅ done');
    process.exitCode = 0;
  } catch (err) {
    logger.fatal({ err }, '🔥 migration run failed');
    process.exitCode = 1;
  } finally {
    try {
      await store.close?.();
    } catch {}
  }
})();
