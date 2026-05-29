'use strict';

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

const logger = require('./logger');
const caches = require('./caches');
const { config } = require('../config');
const { createStore } = require('../store/db');
const { useRedisAuth, useSqliteAuth } = require('./auth');
const { makeSQLiteStore } = require('../store/sqliteStore');
const CommandRegistry = require('./commandRegistry');
const eventRouter = require('../events/router');
const { startDashboard } = require('../dashboard/server');
const { startGC } = require('../lib/tempManager');

const log = logger.child({ mod: 'worker' });

// Queues & Rate Limiting
const chatQueues = new Map();
const userMsgCounts = new Map();
let globalMsgCount = 0;

setInterval(() => {
    userMsgCounts.clear();
    globalMsgCount = 0;
}, 60000); // Clear rate limits every minute

function queueFor(jid) {
  let q = chatQueues.get(jid);
  if (!q) {
    q = new PQueue({ concurrency: config.processing.concurrencyPerChat || 1, autoStart: true });
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
let shuttingDown = false;

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

async function getAuthState() {
    const sessionName = config.options.sessionName;
    if (config.auth.method === 'REDIS') {
        return await useRedisAuth(config.auth.redisUrl, sessionName);
    } else if (config.auth.method === 'SQLITE') {
        return await useSqliteAuth(config.auth.sqlitePath, sessionName);
    } else {
        const sessionDir = path.join(__dirname, '..', '..', sessionName);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
        const multiAuth = await useMultiFileAuthState(sessionDir);
        multiAuth.clear = async () => fs.rmSync(sessionDir, { recursive: true, force: true });
        return multiAuth;
    }
}

async function start(retry = 0) {
  if (shuttingDown) return;

  const authData = await getAuthState();
  const { state, saveCreds, clear } = authData;

  let version;
  try {
    const r = await fetchLatestBaileysVersion();
    version = r.version;
  } catch (e) {
    log.warn('fetchLatestBaileysVersion failed – using bundled');
    version = [2, 3000, 1015901307];
  }

  if (!store) {
    store = createStore(config, log.child({ mod: 'store' }), caches.groupMetadataCache);
  }
  if (!commands) {
    commands = new CommandRegistry({
      dir: path.join(__dirname, '..', 'commands'),
      prefix: config.options.prefix,
      logger: log.child({ mod: 'commands' }),
    });
    await commands.load();
    startGC(log);
  }

  sock = makeWASocket({
    version,
    logger: logger.child({ mod: 'baileys' }),
    browser: Browsers.macOS('EchoFox'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger.child({ mod: 'signal' })),
    },
    markOnlineOnConnect: false,            
    syncFullHistory: config.syncHistory,                
    generateHighQualityLinkPreview: true,
    fireInitQueries: true,
    enableAutoSessionRecreation: true,
    enableRecentMessageCache: true,
    connectTimeoutMs: 30_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,
    retryRequestDelayMs: 350,
    maxMsgRetryCount: 5,
    qrTimeout: 45_000,
    msgRetryCounterCache: caches.msgRetryCounterCache,
    userDevicesCache: caches.userDevicesCache,
    callOfferCache: caches.callOfferCache,
    placeholderResendCache: caches.placeholderResendCache,
    mediaCache: caches.mediaCache,
    getMessage: (key) => store.getMessage(key),
    cachedGroupMetadata: (jid) => store.getGroupMetadata(jid),
    shouldIgnoreJid: (jid) => jid?.endsWith('@newsletter') ||  (jid === 'status@broadcast' && !config.options.ReadStatus),
  });

  sock.ev.on('creds.update', saveCreds);
  store.bind(sock.ev);

  if (config.login.type === 'PAIRING' && !sock.authState.creds.registered) {
    setTimeout(async () => {
      let code = await sock.requestPairingCode(config.login.phoneNumber);
      console.log(`\n\n-----------------------------------------`);
      console.log(`PAIRING CODE: ${code}`);
      console.log(`-----------------------------------------\n\n`);
    }, 3000);
  }

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr && config.login.type === 'QR') {
      log.info('scan QR to log in:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      log.info({ user: sock.user?.id }, '✅ connected');
      process.send?.('ready');
      store.recordStat?.('bot_restarts', 1);

      if (config.dashboard.enabled) {
          startDashboard(config.dashboard.port, store, config);
      }

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

      if (code === DisconnectReason.loggedOut || code === 401 || code === 403) {
        log.error('logged out / forbidden – exiting for re-pair');
        if (clear) await clear();
        process.exit(2);
      }
      const wait = Math.min(2_000 * 2 ** retry, 30_000);
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

  sock.ev.on('messages.upsert', (payload) => {
    if (!payload?.messages?.length) return;
    for (const m of payload.messages) {
      const jid = m?.key?.remoteJid;
      if (!jid) continue;

      const user = m?.key?.participant || jid;

      // Rate Limiting Logic
      let rateLimitPerMinute = config.processing.userRateLimit || 10;
      let globalLimit = config.processing.globalRateLimit || 5;

      let userCount = userMsgCounts.get(user) || 0;
      if (userCount >= rateLimitPerMinute) {
          log.warn({ user }, 'Rate limit hit for user');
          continue; // Drop message
      }
      userMsgCounts.set(user, userCount + 1);

      globalMsgCount++;
      if ((globalMsgCount / 60) > globalLimit) {
          log.warn('Global rate limit hit');
      }

      store.recordStat?.('incoming_messages', 1);

      queueFor(jid).add(() => {
        store.recordStat?.('messages_processed', 1);
        return eventRouter.handleMessage({ sock, m, commands, store, logger: log })
          .catch((e) => log.error({ err: e, jid }, 'message handler crashed'));
      }).catch(() => {});
    }
  });

  sock.ev.on('messages.upsert',           () => store.recordStat?.('db_writes', 1));
  sock.ev.on('groups.update',             (u) => eventRouter.emit('groups.update', { sock, u }));
  sock.ev.on('group-participants.update', (u) => eventRouter.emit('group-participants.update', { sock, u }));
  sock.ev.on('contacts.upsert',           (u) => eventRouter.emit('contacts.upsert', { sock, u }));
  sock.ev.on('call',                      (u) => eventRouter.emit('call', { sock, u }));

  sock.decodeJid = (jid) => (jid ? jidNormalizedUser(jid) : jid);
}

process.on('uncaughtException',  (e) => log.fatal({ err: e }, 'uncaughtException'));
process.on('unhandledRejection', (e) => log.fatal({ err: e }, 'unhandledRejection'));

start().catch((e) => {
  log.fatal({ err: e }, 'failed to start');
  process.exit(1);
});
