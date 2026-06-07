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
const fs   = require('node:fs');

const logger        = require('./logger');
const { config }    = require('../lib/configLoader');
const { useRedisAuth, useSqliteAuth, usePostgresAuth } = require('./auth');
const { setStore } = require('../store/instance');
const metrics       = require('../services/metrics');
const caches        = require('./caches');

const log = logger.child({ mod: 'lifecycle' });

// ─── Phase 1 + 2: logger + config ────────────────────────────────────────
function logBoot() {
  log.info({
    phase: 'config',
    status: 'ok',
    source: config.__meta?.source || 'unknown',
    bot: config.bot.name,
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: config.runtime.logLevel,
  }, '⚙ config loaded');
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
    
    const sessionDir = path.join(__dirname, '..', config.bot.sessionName);

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

// ─── Phase 4: store backend selector ────────────────────────────────────
function selectStore() {
  const type = (config.storeDB.type || 'SQLITE').toUpperCase();
  log.info({ phase: 'store', backend: type }, 'Selecting store backend');

  try {
    const store = createStore(config, log.child({ mod: 'store' }), caches.groupMetadataCache);
    setStore(store);
    log.info({ phase: 'store', status: 'ok', backend: type }, 'Store ready');
    return store;
  } catch (err) {
    log.fatal({ phase: 'store', status: 'error', backend: type, err }, 'Store selection FAILED');
    throw err;
  }
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
      log.info({ phase: 'login', status: 'ok', flow: 'PAIRING' },
        '🆔 already paired — skipping pairing-code request');
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
        log.error({ phase: 'login', status: 'error', flow: 'PAIRING', err },
          '🆔 requestPairingCode failed');
      }
    }, 3000);
  }
  // QR flow is passive — handled in worker's connection.update listener.
}

// ─── Phase 7-pre: WA version fetch (used in worker socket config) ───────
async function fetchVersion() {
  try {
    const { fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
    const r = await fetchLatestBaileysVersion();
    log.info({ phase: 'version', status: 'ok', version: r.version.join('.'), latest: r.isLatest },
      '📡 WA version');
    return r.version;
  } catch (e) {
    log.warn({ phase: 'version', status: 'fallback', err: e },
      '📡 fetchLatestBaileysVersion failed — using bundled');
    return undefined;
  }
}

module.exports = {
  logBoot,
  selectAuth,
  selectStore,
  initMetrics,
  startLoginFlow,
  fetchVersion,
};
