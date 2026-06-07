/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Schema-migration runner.
 *
 *   Reads numbered migration files from:
 *     src/store/migrations/<backend>/NNN_description.js
 *
 *   Each migration file exports:
 *     {
 *       version: 1,                          // integer monotonic
 *       description: 'add foo column',
 *       async up(ctx)   { ... },             // applied on boot
 *       async down(ctx) { ... },             // optional, used by manual rollback
 *     }
 *
 *   ctx shape varies per backend:
 *     sqlite   → { db, logger }            (better-sqlite3 Database)
 *     postgres → { pool, logger }          (pg.Pool)
 *     mongo    → { conn, logger }          (mongoose.Connection)
 *     redis    → { client, logger }        (ioredis.Redis)
 *
 *   Tracking table / collection:
 *     • sqlite/postgres: a `_migrations(version INT PK, applied_at INT)` table
 *     • mongo:            a `_migrations` collection
 *     • redis:            a sorted set `_migrations` (score=version, member=ts)
 *
 *   Boot behaviour (auto-run, default):
 *     1. Read tracking table to get max(version) already applied.
 *     2. Glob src/store/migrations/<backend>/ for files with numbers > current.
 *     3. Apply each in order, wrapped in transaction where supported.
 *     4. Each success: insert into tracking.
 *     5. Any failure aborts boot loudly — fail fast, don't run partial.
 *
 *   Idempotency:
 *     • A migration applied twice will throw; tracker prevents this.
 *     • Migrations themselves should be defensively idempotent
 *       (CREATE TABLE IF NOT EXISTS, ALTER TABLE … ADD COLUMN IF NOT EXISTS)
 *       so they're safe even if the tracker table is wiped.
 */

const fs   = require('node:fs');
const path = require('node:path');
const logger = require('../core/logger').child({ mod: 'migrations' });

const MIGRATIONS_ROOT = path.join(__dirname, '..', 'store', 'migrations');

function _list(backend) {
  const dir = path.join(MIGRATIONS_ROOT, backend.toLowerCase());
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      const m = f.match(/^(\d+)_(.+)\.js$/);
      if (!m) return null;
      return {
        version: Number(m[1]),
        slug: m[2],
        file: path.join(dir, f),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.version - b.version);
}

function _load(file) {
  delete require.cache[require.resolve(file)];
  const mod = require(file);
  if (typeof mod.version !== 'number') throw new Error(`${file}: missing numeric version`);
  if (typeof mod.up !== 'function')    throw new Error(`${file}: missing up()`);
  return mod;
}

// ─── Backend adapters ───────────────────────────────────────────────────

const adapters = {
  sqlite: {
    ensure(ctx) {
      ctx.db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        slug TEXT,
        applied_at INTEGER NOT NULL
      )`);
    },
    applied(ctx) {
      return new Set(
        ctx.db.prepare('SELECT version FROM _migrations').all().map((r) => r.version),
      );
    },
    async run(ctx, mig) {
      const tx = ctx.db.transaction(() => {
        const maybePromise = mig.up(ctx);
        if (maybePromise && typeof maybePromise.then === 'function') {
          throw new Error(
            `SQLite migration ${mig.version} returned a Promise — sqlite ` +
            'migrations must complete synchronously inside the transaction. ' +
            'Use better-sqlite3 sync methods only (db.exec, prepare().run, ...).'
          );
        }
        ctx.db.prepare('INSERT INTO _migrations(version,slug,applied_at) VALUES(?,?,?)')
          .run(mig.version, mig.slug, Math.floor(Date.now() / 1000));
      });
      tx();
    },
  },

  postgres: {
    async ensure(ctx) {
      await ctx.pool.query(`CREATE TABLE IF NOT EXISTS _migrations (
        version BIGINT PRIMARY KEY,
        slug TEXT,
        applied_at BIGINT NOT NULL
      )`);
    },
    async applied(ctx) {
      const r = await ctx.pool.query('SELECT version FROM _migrations');
      return new Set(r.rows.map((row) => Number(row.version)));
    },
    async run(ctx, mig) {
      const client = await ctx.pool.connect();
      try {
        await client.query('BEGIN');
        await mig.up({ ...ctx, pool: client });   // pass client so migration shares tx
        await client.query(
          'INSERT INTO _migrations(version,slug,applied_at) VALUES($1,$2,$3)',
          [mig.version, mig.slug, Math.floor(Date.now() / 1000)],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  },

  mongo: {
    async ensure(ctx) {
      // Mongo collections auto-create on first write
      const Mig = ctx.conn.collection('_migrations');
      await Mig.createIndex({ version: 1 }, { unique: true });
    },
    async applied(ctx) {
      const docs = await ctx.conn.collection('_migrations').find({}, { projection: { version: 1 } }).toArray();
      return new Set(docs.map((d) => d.version));
    },
    async run(ctx, mig) {
      // Mongo lacks multi-collection transactions unless on a replica set.
      // Just run; defensive idempotency in migrations themselves carries the day.
      await mig.up(ctx);
      await ctx.conn.collection('_migrations').insertOne({
        version: mig.version,
        slug: mig.slug,
        applied_at: Math.floor(Date.now() / 1000),
      });
    },
  },

  redis: {
    async ensure(_ctx) { /* keyspace is schemaless */ },
    async applied(ctx) {
      const arr = await ctx.client.zrange('_migrations', 0, -1, 'WITHSCORES');
      const set = new Set();
      for (let i = 0; i < arr.length; i += 2) set.add(Number(arr[i + 1]));
      return set;
    },
    async run(ctx, mig) {
      await mig.up(ctx);
      await ctx.client.zadd('_migrations', mig.version, `v${mig.version}_${mig.slug}_${Date.now()}`);
    },
  },
};

/**
 * Run all pending migrations for the given backend.
 *   backend: 'sqlite' | 'postgres' | 'mongo' | 'redis'
 *   ctx:     adapter-specific (db / pool / conn / client) — see top of file
 *
 *   Returns: { applied: [{version, slug}], skipped: number }
 *   Throws on first failure (fail-fast at boot).
 */
async function runMigrations(backend, ctx) {
  const adapter = adapters[backend.toLowerCase()];
  if (!adapter) throw new Error(`migrationsRunner: unsupported backend "${backend}"`);

  const all = _list(backend);
  if (!all.length) {
    logger.info({ backend }, 'no migrations defined — skipping');
    return { applied: [], skipped: 0 };
  }

  await adapter.ensure({ ...ctx, logger });
  const appliedSet = await adapter.applied({ ...ctx, logger });

  const pending = all.filter((m) => !appliedSet.has(m.version));
  if (!pending.length) {
    logger.info({ backend, total: all.length }, '✅ migrations: all up to date');
    return { applied: [], skipped: all.length };
  }

  logger.info({ backend, pending: pending.length }, '⚙ applying migrations');
  const appliedNow = [];
  for (const meta of pending) {
    const t0 = Date.now();
    let mig;
    try { mig = _load(meta.file); }
    catch (err) {
      logger.fatal({ err, file: meta.file }, 'migration file invalid');
      throw err;
    }
    try {
      await adapter.run({ ...ctx, logger }, { ...mig, version: meta.version, slug: meta.slug });
      logger.info({ version: meta.version, slug: meta.slug, ms: Date.now() - t0 },
        '✅ migration applied');
      appliedNow.push({ version: meta.version, slug: meta.slug });
    } catch (err) {
      logger.fatal({ err, version: meta.version, slug: meta.slug },
        '🔥 migration failed — aborting boot');
      throw err;
    }
  }
  return { applied: appliedNow, skipped: all.length - appliedNow.length };
}

module.exports = { runMigrations };
