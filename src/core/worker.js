'use strict';

/**
 * EchoFox worker
 * ──────────────
 * Owns ONE Baileys socket. The parent (bootstrap.js) restarts us on
 * crashes; *inside* this process we never call process.exit() except on
 * fatal auth errors (loggedOut / forbidden). All other disconnects are
 * recovered by reconnecting the socket without tearing the process down,
 * which preserves caches and avoids cold-start overhead.
 */

require('events').EventEmitter.defaultMaxListeners = 100;

const path  = require('node:path');
const fs    = require('node:fs');
const NodeCache = require('node-cache');
const PQueue = require('p-queue').default;
const qrcode = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');

const logger        = require('./logger');
const caches        = require('./caches');
const { config }    = require('../config');
const { makeSQLiteStore } = require('../store/sqliteStore');
const CommandRegistry = require('./commandRegistry');
const eventRouter   = require('../events/router');

const log = logger.child({ mod: 'worker' });

// ─── Per-chat queues = back-pressure & FIFO ordering ──────────────────────
// One queue per chat so heavy media commands in chat A don't block chat B.
const chatQueues = new Map();
function queueFor(jid) {
  let q = chatQueues.get(jid);
  if (!q) {
    q = new PQueue({ concurrency: 1, autoStart: true });
    q.on('idle', () => {
      // GC empty queues to bound memory in million-chat scenarios
      if (q.size === 0 && q.pending === 0) chatQueues.delete(jid);
    });
    chatQueues.set(jid, q);
  }
  return q;
}

let sock;          // current socket
let store;         // sqlite store handle
let commands;      // CommandRegistry
let shuttingDown = false;

// ─── IPC from supervisor ──────────────────────────────────────────────────
process.on('message', async (msg) => {
  if (msg === 'shutdown') {
    shuttingDown = true;
    log.info('shutdown signal from supervisor');
    try { await sock?.logout?.(); } catch {}
    try { sock?.end?.(undefined); } catch {}
    try { store?.close?.(); } catch {}
    setTimeout(() => process.exit(0), 1500);
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────
async function start(retry = 0) {
  if (shuttingDown) return;

  // 1. Auth state (multi-file).
  const sessionDir = path.join(__dirname, '..', config.options.sessionName);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  // 2. WA version (cached negotiate).
  let version;
  try {
    const r = await fetchLatestBaileysVersion();
    version = r.version;
    log.info({ version: version.join('.'), isLatest: r.isLatest }, 'WA version');
  } catch (e) {
    log.warn({ err: e }, 'fetchLatestBaileysVersion failed – using bundled');
  }

  // 3. Store + command registry (only once).
  if (!store) {
    store = makeSQLiteStore({
      dbPath: path.join(__dirname, '..', 'store', 'runtime', 'wa.db'),
      logger: log.child({ mod: 'store' }),
      groupCache: caches.groupMetadataCache,
    });
  }
  if (!commands) {
    commands = new CommandRegistry({
      dir: path.join(__dirname, '..', 'commands'),
      prefix: config.options.prefix,
      logger: log.child({ mod: 'commands' }),
    });
    await commands.load();
  }

  // 4. The socket. NOTE: printQRInTerminal is deprecated in 7.x – we
  //    render the QR ourselves below.
  sock = makeWASocket({
    version,
    logger: logger.child({ mod: 'baileys' }),
    browser: Browsers.macOS('EchoFox'),
    auth: {
      creds: state.creds,
      // The cacheable key store is the single biggest send/receive perf win.
      keys: makeCacheableSignalKeyStore(state.keys, logger.child({ mod: 'signal' })),
    },

    // ─── Performance / scalability knobs ────────────────────────────────
    markOnlineOnConnect: false,            // don't trigger push notifs to phone
    syncFullHistory: false,                // huge memory saver; flip to true if you need history
    generateHighQualityLinkPreview: true,
    fireInitQueries: true,
    enableAutoSessionRecreation: true,     // 7.x: auto-heal broken signal sessions
    enableRecentMessageCache: true,        // 7.x: faster retry handling

    connectTimeoutMs: 30_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,
    retryRequestDelayMs: 350,
    maxMsgRetryCount: 5,
    qrTimeout: 45_000,

    // ─── Caches (see core/caches.js) ────────────────────────────────────
    msgRetryCounterCache:   caches.msgRetryCounterCache,
    userDevicesCache:       caches.userDevicesCache,
    callOfferCache:         caches.callOfferCache,
    placeholderResendCache: caches.placeholderResendCache,
    mediaCache:             caches.mediaCache,

    // Critical contract methods
    getMessage: (key) => store.getMessage(key),
    cachedGroupMetadata: (jid) => store.getGroupMetadata(jid),

    // Don't decrypt/emit for newsletter / status if you don't use them
    shouldIgnoreJid: (jid) =>
      jid?.endsWith('@newsletter') ||
      (jid === 'status@broadcast' && !config.options.ReadStatus),
  });

  // Persist creds
  sock.ev.on('creds.update', saveCreds);

  // Persistent store binding
  store.bind(sock.ev);

  // ─── Connection lifecycle ───────────────────────────────────────────
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      log.info('scan QR to log in:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      log.info({ user: sock.user?.id }, '✅ connected');
      process.send?.('ready');

      // Warm the group metadata cache once.
      try {
        const groups = await sock.groupFetchAllParticipating();
        for (const [jid, meta] of Object.entries(groups)) {
          store.saveGroupMetadata(jid, meta);
        }
        log.info({ groups: Object.keys(groups).length }, 'group cache warmed');
      } catch (e) {
        log.warn({ err: e }, 'group warm-up failed');
      }
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode
        : lastDisconnect?.error?.output?.statusCode;
      const reason = Object.entries(DisconnectReason).find(([, v]) => v === code)?.[0] || 'unknown';
      log.warn({ code, reason }, 'connection closed');

      // Fatal? Don't reconnect – let supervisor restart fresh OR exit.
      if (code === DisconnectReason.loggedOut || code === 401 || code === 403) {
        log.error('logged out / forbidden – exiting for re-pair');
        process.exit(2);
      }

      // Otherwise reconnect in-process (no cold start).
      const wait = Math.min(2_000 * 2 ** retry, 30_000);
      log.info({ wait }, 'reconnecting…');
      setTimeout(() => start(retry + 1), wait);
    }
  });

  // ─── Group metadata invalidation ────────────────────────────────────
  sock.ev.on('groups.update', async (updates) => {
    for (const u of updates) {
      try {
        const fresh = await sock.groupMetadata(u.id);
        store.saveGroupMetadata(u.id, fresh);
      } catch {}
    }
  });
  sock.ev.on('group-participants.update', async (u) => {
    try {
      const fresh = await sock.groupMetadata(u.id);
      store.saveGroupMetadata(u.id, fresh);
    } catch {}
  });

  // ─── Message routing (the hot path) ─────────────────────────────────
  // Baileys is fast at *receiving*; the bottleneck is your handlers.
  // We push each msg onto its chat-queue (FIFO per chat, parallel across
  // chats) so a slow handler never starves the socket.
  sock.ev.on('messages.upsert', (payload) => {
    if (!payload?.messages?.length) return;
    for (const m of payload.messages) {
      const jid = m?.key?.remoteJid;
      if (!jid) continue;
      queueFor(jid).add(() =>
        eventRouter.handleMessage({ sock, m, commands, store, logger: log })
          .catch((e) => log.error({ err: e, jid }, 'message handler crashed')),
      ).catch(() => {});
    }
  });

  // Other events go through the router too (no queueing needed).
  sock.ev.on('groups.update',             (u) => eventRouter.emit('groups.update', { sock, u }));
  sock.ev.on('group-participants.update', (u) => eventRouter.emit('group-participants.update', { sock, u }));
  sock.ev.on('contacts.upsert',           (u) => eventRouter.emit('contacts.upsert', { sock, u }));
  sock.ev.on('call',                      (u) => eventRouter.emit('call', { sock, u }));

  // Convenience method used by handlers.
  sock.decodeJid = (jid) => (jid ? jidNormalizedUser(jid) : jid);
}

// ─── Fatal handlers (don't crash silently) ────────────────────────────────
process.on('uncaughtException',  (e) => log.fatal({ err: e }, 'uncaughtException'));
process.on('unhandledRejection', (e) => log.fatal({ err: e }, 'unhandledRejection'));

start().catch((e) => {
  log.fatal({ err: e }, 'failed to start');
  process.exit(1);
});
