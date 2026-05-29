/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * EchoFox worker — orchestrates the boot chain via lifecycle.js, then
 * runs the Baileys socket.
 *
 * Boot order is enforced by src/core/lifecycle.js (config → auth → store
 * → metrics → commands → socket → login → ready). This file's only job
 * is to glue lifecycle's outputs into a live Baileys socket.
 *
 * Everything specific to "how do we authenticate" or "where do we store"
 * lives in lifecycle/auth/store modules. This file should stay short.
 */

require('events').EventEmitter.defaultMaxListeners = 100;

const path   = require('node:path');
const PQueue = require('p-queue').default;
const qrcode = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');

const {
  default: makeWASocket,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');

const logger    = require('./logger');
const caches    = require('./caches');
const { config } = require('../lib/configLoader');

const lifecycle = require('./lifecycle');
const metrics   = require('../services/metrics');
const CommandRegistry = require('./commandRegistry');
const eventRouter     = require('../events/router');
const { startDashboard } = require('../dashboard/server');
const { startGC }        = require('../lib/tempManager');
const { wrapSocketSend } = require('../middleware/sendQueue');

const log = logger.child({ mod: 'worker' });

// ─── Per-chat queues (back-pressure) ─────────────────────────────────────
const chatQueues = new Map();
function queueFor(jid) {
  let q = chatQueues.get(jid);
  if (!q) {
    q = new PQueue({
      concurrency: config.processing.concurrencyPerChat || 1,
      autoStart: true,
    });
    q.on('idle', () => {
      if (q.size === 0 && q.pending === 0) chatQueues.delete(jid);
    });
    chatQueues.set(jid, q);
  }
  return q;
}

let sock;
let store;
let commands;
let auth;
let dashboardStarted = false;
let shuttingDown = false;

// ─── IPC from supervisor ─────────────────────────────────────────────────
process.on('message', async (msg) => {
  if (msg === 'shutdown') {
    shuttingDown = true;
    log.info({ phase: 'shutdown' }, 'shutdown signal from supervisor');
    try { await sock?.logout?.(); } catch {}
    try { sock?.end?.(undefined); } catch {}
    try { store?.close?.(); } catch {}
    try { auth?.close?.(); }  catch {}
    setTimeout(() => process.exit(0), 1500);
  }
});

// ─── Periodic gauge refresh (uptime, group counts, unique users) ────────
function startGaugeRefresh() {
  setInterval(async () => {
    try {
      const [groupsCount, uniqueUsersSeen] = await Promise.all([
        store.countGroups?.(),
        store.countUniqueUsers?.(),
      ]);
      metrics.refreshDerivedGauges({ groupsCount, uniqueUsersSeen });
    } catch (e) {
      log.debug({ err: e }, 'gauge refresh failed');
    }
  }, 30_000).unref();
}

// ─── Boot ────────────────────────────────────────────────────────────────
async function start(retry = 0) {
  if (shuttingDown) return;

  // ─── Phases 1-2: logger + config (already done; emit banner log) ───
  if (retry === 0) lifecycle.logBoot();

  // ─── Phase 3: auth backend ─────────────────────────────────────────
  auth = await lifecycle.selectAuth();
  const { state, saveCreds, clear } = auth;

  // ─── Phase 4: store backend (only on first boot) ───────────────────
  if (!store) {
    store = lifecycle.selectStore();
    // ─── Phase 5: metrics ────────────────────────────────────────────
    lifecycle.initMetrics(store);
    startGaugeRefresh();
  }

  // ─── Phase 6: command registry (only on first boot) ────────────────
  if (!commands) {
    commands = new CommandRegistry({
      dir:    path.join(__dirname, '..', 'commands'),
      prefix: config.bot.prefix,
      logger: log.child({ mod: 'commands' }),
      config,
    });
    await commands.load();
    log.info({ phase: 'commands', status: 'ok', count: commands.commands.size },
      '🧩 commands loaded');
    startGC(log);
  }

  // ─── Phase 7: socket ───────────────────────────────────────────────
  const version = await lifecycle.fetchVersion();

  sock = makeWASocket({
    version,
    logger: logger.child({ mod: 'baileys' }),
    browser: Browsers.macOS('EchoFox'),
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, logger.child({ mod: 'signal' })),
    },

    markOnlineOnConnect:            false,
    syncFullHistory:                !!config.features.syncHistory,
    generateHighQualityLinkPreview: true,
    fireInitQueries:                true,
    enableAutoSessionRecreation:    true,
    enableRecentMessageCache:       true,

    connectTimeoutMs:      30_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs:   25_000,
    retryRequestDelayMs:   350,
    maxMsgRetryCount:      5,
    qrTimeout:             45_000,

    msgRetryCounterCache:   caches.msgRetryCounterCache,
    userDevicesCache:       caches.userDevicesCache,
    callOfferCache:         caches.callOfferCache,
    placeholderResendCache: caches.placeholderResendCache,
    mediaCache:             caches.mediaCache,

    getMessage:          (key) => store.getMessage(key),
    cachedGroupMetadata: (jid) => store.getGroupMetadata(jid),

    shouldIgnoreJid: (jid) =>
      jid?.endsWith('@newsletter') ||
      (jid === 'status@broadcast' && !config.features.readStatus),
  });

  sock.ev.on('creds.update', saveCreds);
  store.bind(sock.ev);

  // ─── Phase 8: login flow (QR auto-renders here, pairing in lifecycle) ─
  await lifecycle.startLoginFlow(sock);

  // ─── Connection lifecycle ──────────────────────────────────────────
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr && (config.login.type || 'QR').toUpperCase() === 'QR') {
      log.info({ phase: 'login', flow: 'QR' }, '🆔 scan QR to log in:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      log.info({ phase: 'ready', status: 'ok', user: sock.user?.id }, '✅ connected');
      process.send?.('ready');

      // Wrap outbound sends in a global concurrency queue (once)
      if (!sock._sendWrapped) {
        wrapSocketSend(sock, { concurrency: config.processing.sendConcurrency || 4 });
        sock._sendWrapped = true;
        log.info({ concurrency: config.processing.sendConcurrency || 4 },
          'outbound send queue wired');
      }

      // Optional dashboard (once)
      if (config.dashboard.enabled && !dashboardStarted) {
        try {
          startDashboard(config.dashboard.port, store, config);
          dashboardStarted = true;
          log.info({ phase: 'dashboard', port: config.dashboard.port }, '📊 dashboard started');
        } catch (e) {
          log.error({ err: e }, 'dashboard failed to start');
        }
      }

      // Warm group cache + snapshot current participants
      try {
        const groups = await sock.groupFetchAllParticipating();
        for (const [jid, meta] of Object.entries(groups)) {
          store.saveGroupMetadata(jid, meta);
          // Bootstrap participant log if this group has no history yet.
          // (We treat first-sight as 'add' so later 'leave' events have a baseline.)
          const existing = await store.getParticipantHistory(jid, 1).catch(() => []);
          if (!existing.length) {
            const now = Math.floor(Date.now() / 1000);
            for (const p of meta.participants || []) {
              store.recordParticipantEvent(jid, p.id, 'add', null, now);
              if (p.admin) {
                store.recordParticipantEvent(
                  jid, p.id,
                  p.admin === 'superadmin' ? 'promote' : 'promote',
                  null, now,
                );
              }
            }
          }
        }
        log.info({ phase: 'warm', groups: Object.keys(groups).length },
          '🔥 group cache warmed + participant snapshot ensured');
      } catch (e) {
        log.warn({ err: e }, 'group warm-up failed');
      }
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode
        : lastDisconnect?.error?.output?.statusCode;
      const reason = Object.entries(DisconnectReason).find(([, v]) => v === code)?.[0] || 'unknown';
      log.warn({ phase: 'connection', status: 'closed', code, reason }, 'connection closed');

      if (code === DisconnectReason.loggedOut || code === 401 || code === 403) {
        log.error({ phase: 'connection', status: 'logged_out' },
          'logged out / forbidden – exiting for re-pair');
        try { if (clear) await clear(); } catch {}
        process.exit(2);
      }
      const wait = Math.min(2_000 * 2 ** retry, 30_000);
      log.info({ wait }, 'reconnecting…');
      setTimeout(() => start(retry + 1), wait);
    }
  });

  // ─── Group metadata invalidation + participant-event recording ─────
  sock.ev.on('groups.update', async (updates) => {
    for (const u of updates) {
      try {
        const fresh = await sock.groupMetadata(u.id);
        store.saveGroupMetadata(u.id, fresh);
      } catch {}
    }
  });

  // Forward participant change to dedicated handler (records events).
  sock.ev.on('group-participants.update', (u) =>
    eventRouter.emit('group-participants.update', { sock, store, u }));

  // Other event forwards
  sock.ev.on('contacts.upsert', (u) => eventRouter.emit('contacts.upsert', { sock, u }));
  sock.ev.on('call',            (u) => eventRouter.emit('call',            { sock, u }));
  sock.ev.on('groups.update',   (u) => eventRouter.emit('groups.update',   { sock, u }));

  // ─── The hot path: message routing ─────────────────────────────────
  sock.ev.on('messages.upsert', (payload) => {
    if (!payload?.messages?.length) return;
    metrics.incReceived(payload.messages.length);
    for (const m of payload.messages) {
      const jid = m?.key?.remoteJid;
      if (!jid) continue;
      queueFor(jid).add(() =>
        eventRouter.handleMessage({ sock, m, commands, store, logger: log })
          .catch((e) => log.error({ err: e, jid }, 'message handler crashed')),
      ).catch(() => {});
    }
  });

  // Bind a helper used by some commands
  sock.decodeJid = (jid) => (jid ? jidNormalizedUser(jid) : jid);
}

// ─── Fatal handlers ──────────────────────────────────────────────────────
process.on('uncaughtException',  (e) => log.fatal({ err: e }, 'uncaughtException'));
process.on('unhandledRejection', (e) => log.fatal({ err: e }, 'unhandledRejection'));

start().catch((e) => {
  log.fatal({ err: e }, 'failed to start');
  process.exit(1);
});
