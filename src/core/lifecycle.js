/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Boot-time orchestration.
 *
 *   The worker delegates the entire startup chain to this module so we
 *   have ONE place that documents the boot order, logs each phase, and
 *   fails loudly with a clear error if any phase doesn't complete.
 *
 *   Boot sequence (in order):
 *     1. logger      — set up structured logging child
 *     2. config      — already loaded by configLoader; verify & log source
 *     3. auth        — select backend (MULTIFILE | SQLITE | REDIS | POSTGRES)
 *                      and load credentials
 *     4. store       — select backend (SQLITE | POSTGRES | MONGODB | REDIS)
 *                      and connect; create schemas
 *     5. metrics     — initialise typed metrics service against the store
 *     6. commands    — load the command registry
 *     7. socket      — build the Baileys socket and bind events
 *     8. login       — select flow (QR | PAIRING) — request pairing code if needed
 *     9. ready       — wait for connection.open
 *
 *   Each phase logs `phase: <name> status: ok|error backend: <type>` so
 *   ops can diagnose boot issues from logs alone.
 *
 *   The selectors (auth + store) return ALREADY-CONSTRUCTED objects so
 *   this file stays the single source of truth for which backend is
 *   chosen at runtime. The worker just consumes what lifecycle returns.
 */

const path = require('node:path');
const fs = require('node:fs');

const logger = require('./logger');
const { config } = require('../lib/configLoader');
const { useRedisAuth, useSqliteAuth, usePostgresAuth } = require('./auth');
const { createStore } = require('../store/db');
const { setStore } = require('../store/instance');
const { runMigrations } = require('../lib/migrationsRunner');
const metrics = require('../services/metrics');
const caches = require('./caches');

const log = logger.child({ mod: 'lifecycle' });

// ─── Phase 1 + 2: logger + config ────────────────────────────────────────
function logBoot() {
  log.info(
    {
      phase: 'config',
      status: 'ok',
      source: config.__meta?.source || 'unknown',
      bot: config.bot.name,
      nodeEnv: process.env.NODE_ENV || 'development',
      logLevel: config.runtime.logLevel,
    },
    '⚙ config loaded',
  );
}

// ─── Phase 3: auth backend selector ──────────────────────────────────────
async function selectAuth() {
  const method = (config.auth.method || 'MULTIFILE').toUpperCase();
  log.info({ phase: 'auth', backend: method }, '🔐 selecting auth backend');

  try {
    if (method === 'REDIS') {
      const auth = await useRedisAuth(config.auth.redisUrl, config.bot.sessionName);
      log.info({ phase: 'auth', status: 'ok', backend: 'REDIS' }, '🔐 auth ready');
      return auth;
    }
    if (method === 'SQLITE') {
      const auth = await useSqliteAuth(config.auth.sqlitePath, config.bot.sessionName);
      log.info({ phase: 'auth', status: 'ok', backend: 'SQLITE' }, '🔐 auth ready');
      return auth;
    }
    if (method === 'POSTGRES') {
      const auth = await usePostgresAuth(
        config.auth.postgresUrl || config.storeDB.postgresUrl,
        config.bot.sessionName,
      );
      log.info({ phase: 'auth', status: 'ok', backend: 'POSTGRES' }, 'Auth ready');
      return auth;
    }

    // MULTIFILE (default)
    const { useMultiFileAuthState } = require('@whiskeysockets/baileys');

    // v1.5.0 security: session files are NOT inside src/ anymore by default.
    // Resolution rules (in order):
    //   1. Absolute path in config.bot.sessionDir → use as-is
    //   2. Relative path in config.bot.sessionDir → relative to process.cwd()
    //   3. Legacy fallback: config.bot.sessionName joined to ../src (back-compat
    //      for users with existing src/@session/ folders — emit a warning)
    let sessionDir;
    const cfgDir = config.bot.sessionDir;
    if (cfgDir && path.isAbsolute(cfgDir)) {
      sessionDir = cfgDir;
    } else if (cfgDir) {
      sessionDir = path.resolve(process.cwd(), cfgDir);
    } else {
      // Legacy path — still works but warns
      sessionDir = path.join(__dirname, '..', config.bot.sessionName);
      if (fs.existsSync(sessionDir)) {
        log.warn(
          {
            phase: 'auth',
            legacyDir: sessionDir,
            recommended: path.resolve(process.cwd(), 'data', 'sessions'),
          },
          'v1.5.0 security warning: session files are inside the src/ tree. ' +
            'Move them outside (e.g. ./data/sessions/) and set config.bot.sessionDir. ' +
            'A web exploit exposing static files could leak your WA credentials.',
        );
      } else {
        // Fresh install — default to the safe location
        sessionDir = path.resolve(process.cwd(), 'data', 'sessions');
      }
    }

    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const auth = await useMultiFileAuthState(sessionDir);

    auth.clear = async () => fs.rmSync(sessionDir, { recursive: true, force: true });
    log.info({ phase: 'auth', status: 'ok', backend: 'MULTIFILE', dir: sessionDir }, 'Auth ready');
    return auth;
  } catch (err) {
    log.fatal({ phase: 'auth', status: 'error', backend: method, err }, 'Auth selection FAILED');
    throw err;
  }
}

// Mapping from storeDB.type to migrationsRunner backend key (dir name)
const MIGRATIONS_BACKEND = {
  SQLITE: 'sqlite',
  POSTGRES: 'postgres',
  MONGODB: 'mongo',
  REDIS: 'redis',
};

// ─── Phase 4: store backend selector ────────────────────────────────────
async function selectStore() {
  const type = (config.storeDB.type || 'SQLITE').toUpperCase();
  log.info({ phase: 'store', backend: type }, 'Selecting store backend');

  let store;
  try {
    store = createStore(config, log.child({ mod: 'store' }), caches.groupMetadataCache);
  } catch (err) {
    log.fatal({ phase: 'store', status: 'error', backend: type, err }, 'Store selection FAILED');
    throw err;
  }

  // ─── auto-run pending migrations ──────────────────────────────
  if (config.storeDB.runMigrationsOnBoot !== false) {
    const mBackend = MIGRATIONS_BACKEND[type];
    if (!mBackend) {
      log.warn(
        { phase: 'migrations', backend: type },
        'no migrations adapter for this backend — skipping',
      );
    } else {
      // Build adapter-specific ctx from the freshly-constructed store.
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
        log.fatal(
          { phase: 'migrations', backend: type, ctx: Object.keys(ctx || {}) },
          'store did not expose the primitive needed for migrations (db/pool/conn/client)',
        );
        throw new Error(`migrations: ${type} store did not expose its DB primitive`);
      }
      try {
        const result = await runMigrations(mBackend, ctx);
        log.info(
          {
            phase: 'migrations',
            backend: mBackend,
            applied: result.applied.length,
            skipped: result.skipped,
          },
          'migrations complete',
        );
      } catch (err) {
        log.fatal(
          { phase: 'migrations', backend: mBackend, err },
          'migrations failed — aborting boot',
        );
        // Close the half-bootstrapped store before re-throwing to avoid
        // leaking handles to the supervisor's restart loop.
        try {
          await store.close?.();
        } catch {}
        throw err;
      }
    }
  } else {
    log.info(
      { phase: 'migrations', backend: type },
      'storeDB.runMigrationsOnBoot is false — skipping (use `npm run migrate` for manual runs)',
    );
  }

  setStore(store);
  log.info({ phase: 'store', status: 'ok', backend: type }, 'Store ready');
  return store;
}

// ─── Phase 5: metrics ───────────────────────────────────────────────────
function initMetrics(store) {
  try {
    metrics.init(store);
    log.info({ phase: 'metrics', status: 'ok' }, 'Metrics initialised');
  } catch (err) {
    log.error({ phase: 'metrics', status: 'error', err }, 'Metrics init failed (continuing)');
  }
}

// ─── Phase 8: login flow ────────────────────────────────────────────────
/**
 * If config.login.type === 'PAIRING', request and print a pairing code
 * once the socket is built but before connection opens.
 * For 'QR', the socket's connection.update emits the QR string — the
 * worker handles rendering it via qrcode-terminal.
 */
async function startLoginFlow(sock) {
  const type = (config.login.type || 'QR').toUpperCase();
  log.info({ phase: 'login', flow: type }, '🆔 login flow');

  if (type === 'PAIRING') {
    if (!config.login.phoneNumber) {
      throw new Error('login.type=PAIRING requires login.phoneNumber (digits only)');
    }
    if (sock.authState.creds.registered) {
      log.info(
        { phase: 'login', status: 'ok', flow: 'PAIRING' },
        '🆔 already paired — skipping pairing-code request',
      );
      return;
    }
    // Wait a beat so socket can finish its noise handshake init.
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(config.login.phoneNumber);
        console.log(
          `\n\n──────────────────────────────────\n` +
            `  PAIRING CODE: ${code}\n` +
            `──────────────────────────────────\n` +
            `  WhatsApp → Linked devices →\n` +
            `  Link with phone number instead\n` +
            `──────────────────────────────────\n\n`,
        );
        log.info({ phase: 'login', status: 'ok', flow: 'PAIRING' }, '🆔 pairing code issued');
      } catch (err) {
        log.error(
          { phase: 'login', status: 'error', flow: 'PAIRING', err },
          '🆔 requestPairingCode failed',
        );
      }
    }, 3000);
  }
  // QR flow is passive — handled in worker's connection.update listener.
}

// ─── Phase 7-pre: WA version fetch (used in worker socket config) ───────
//
// Why this does NOT use fetchLatestBaileysVersion()
// ------------------------------------------------
// fetchLatestBaileysVersion() reads
//   https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json
// i.e. the client_revision baked into the Baileys package. Measured on
// 2026-10-13 with the pinned 6.7.24:
//
//   fetchLatestBaileysVersion() -> [2, 3000, 1043857760]   <- package-pinned
//   fetchLatestWaWebVersion()   -> [2, 3000, 1050196505]   <- live, from sw.js
//   gap: 6,338,745 revisions
//
// WhatsApp refuses to complete handshakes from a client_revision that far
// behind. The symptom is a connect -> close loop *during login* with a status
// code that has no DisconnectReason member (405, 516, ...), so the logs just
// say "connection closed" with an unknown code. Upstream:
// WhiskeySockets/Baileys#2679. Reported against other Baileys projects too,
// e.g. FaserF/ha-whatsapp#106 — "Stale WA Web version from
// fetchLatestBaileysVersion() blocks new device linking (connect -> close
// loop, no QR)".
//
// fetchLatestWaWebVersion() scrapes the live client_revision out of
// https://web.whatsapp.com/sw.js, so it tracks what the server actually
// accepts.
//
// Precedence
//   1. config.network.waWebVersion — manual pin. Use this if a live version
//      ever trips your pinned Baileys' protobufs ("newer versions can be
//      incompatible" — see docs).
//   2. fetchLatestWaWebVersion()   — live value (default).
//   3. undefined                   — Baileys' own bundled default.

/** Accept [2,3000,1050196505] or "2.3000.1050196505" → normalised array. */
function normaliseWaVersion(v) {
  if (v == null || v === '') return undefined;
  const parts = Array.isArray(v) ? v.map(Number) : String(v).split('.').map(Number);
  if (parts.length !== 3 || !parts.every((n) => Number.isInteger(n) && n > 0)) return undefined;
  return parts;
}

// Cache the resolved version so a reconnect burst does not issue one HTTPS
// request to web.whatsapp.com per attempt. start() runs on every reconnect and
// calls this, so without a cache a flapping connection hammers sw.js.
const VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h
let _versionCache = { value: null, at: 0 };

async function fetchVersion() {
  // 1. Explicit pin wins (pins bypass the cache — they are already constant).
  const pinned = normaliseWaVersion(config.network?.waWebVersion);
  if (pinned) {
    log.info(
      { phase: 'version', status: 'pinned', version: pinned.join('.') },
      '📡 WA version (pinned via config.network.waWebVersion)',
    );
    return pinned;
  }

  // Use the memoised value while it is fresh.
  if (_versionCache.value && Date.now() - _versionCache.at < VERSION_CACHE_TTL_MS) {
    log.debug(
      { phase: 'version', status: 'cached', version: _versionCache.value.join('.') },
      '📡 WA version (cached)',
    );
    return _versionCache.value;
  }

  // 2. Live client_revision.
  try {
    const { fetchLatestWaWebVersion } = require('@whiskeysockets/baileys');
    const r = await fetchLatestWaWebVersion();

    if (r?.version && r.isLatest) {
      _versionCache = { value: r.version, at: Date.now() };
      log.info(
        { phase: 'version', status: 'ok', version: r.version.join('.') },
        '📡 WA version (live)',
      );
      return r.version;
    }

    // It did not throw, but it also could not read sw.js and fell back to the
    // package-pinned revision — the exact value that breaks new device links.
    log.warn(
      {
        phase: 'version',
        status: 'package_fallback',
        version: r?.version?.join('.'),
        err: r?.error?.message,
      },
      '📡 fetchLatestWaWebVersion could not read a live client_revision — ' +
        'falling back to the Baileys bundled version. New device linking may ' +
        'fail with an unknown disconnect code. Pin config.network.waWebVersion ' +
        'to a known-good value if so.',
    );
    return r?.version;
  } catch (e) {
    log.warn(
      { phase: 'version', status: 'fallback', err: e },
      '📡 fetchLatestWaWebVersion threw — using the Baileys bundled default',
    );
    return undefined; // makeWASocket falls back to its bundled version
  }
}

// ─── v1.5.0: Baileys package version sanity check ───────────────────────
//
// Baileys is a reverse-engineered library that breaks when Meta pushes
// a WhatsApp protocol update. RC/beta versions are pre-release and can
// stop working without notice. Warn loudly so operators know they're
// running on potentially-unstable software.
function checkBaileysVersion() {
  try {
    const pkg = require('@whiskeysockets/baileys/package.json');
    const v = pkg.version || 'unknown';
    const isPrerelease = /-(?:rc|beta|alpha|next|preview|dev)\b/i.test(v);
    if (isPrerelease) {
      log.warn(
        { phase: 'baileys-version', version: v, status: 'prerelease' },
        '⚠️  Baileys is a pre-release (' +
          v +
          '). WhatsApp protocol updates ' +
          'may silently break the bot. Watch https://github.com/WhiskeySockets/Baileys/releases ' +
          'and pin to a GA version when available.',
      );
    } else {
      log.info({ phase: 'baileys-version', version: v, status: 'stable' }, 'Baileys version: ' + v);
    }
  } catch (e) {
    log.warn(
      { phase: 'baileys-version', err: e.message },
      'Could not read Baileys package version',
    );
  }
}

module.exports = {
  logBoot,
  selectAuth,
  selectStore,
  checkBaileysVersion,
  initMetrics,
  startLoginFlow,
  fetchVersion,
  /** Drop the memoised WA Web version. Called when the server rejects it
   *  with 405 CLIENT_TOO_OLD so the next start() re-resolves it. */
  invalidateVersionCache() {
    _versionCache = { value: null, at: 0 };
  },
};
