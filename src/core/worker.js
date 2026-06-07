/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

require('events').EventEmitter.defaultMaxListeners = 100;

const BOT_BOOT_TS = Math.floor(Date.now() / 1000);
const HISTORY_GRACE_SEC = 30; 

// ─── Network: load extra CAs into process-wide TLS contexts ────────────
require('../lib/network').applyExtraCAsToProcess();

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
const { wrapWithPresence } = require('../middleware/presence');
const { getWsAgent, applyExtraCAsToProcess } = require('../lib/network');
const { startMemoryGuard } = require('../lib/memoryGuard');
const alertEngine          = require('../services/alertEngine');
const diagnostics          = require('../lib/diagnostics');
const { checkAndDeliver: checkTheHackerNews } = require('../services/thehackersnewsService');
const {
  checkAndDeliver: checkAlienVault,
  CHECK_INTERVAL: AV_INTERVAL_MIN,
} = require('../services/alienvaultService');

const log = logger.child({ mod: 'worker' });

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

setInterval(async () => {
  try {
    await checkTheHackerNews(sock);
  } catch (err) {
    log.error({ err }, '[thehackersnews] Cron job failed');
  }
}, 60 * 60 * 1000).unref();


setInterval(async () => {
  try {
    await checkAlienVault(sock);
  } catch (err) {
    log.error({ err }, '[alienvault] Cron job failed');
  }
}, (AV_INTERVAL_MIN || 60) * 60 * 1000).unref();

async function start(retry = 0) {
  if (shuttingDown) return;

  if (retry === 0) lifecycle.logBoot();

  auth = await lifecycle.selectAuth();
  const { state, saveCreds, clear } = auth;

  if (!store) {
    store = await lifecycle.selectStore();
    lifecycle.initMetrics(store);
    startGaugeRefresh();

    alertEngine.init({
      windowMinutes:        config.alerts.windowMinutes,
      minInvocations:       config.alerts.minInvocations,
      failureRateThreshold: config.alerts.failureRateThreshold,
    });
    startMemoryGuard({ config });
  }
  
  if (!commands) {
    commands = new CommandRegistry({
      dir:    path.join(__dirname, '..', 'commands'),
      prefix: config.bot.prefix,
      logger: log.child({ mod: 'commands' }),
      config,
    });
    await commands.load();
    log.info({ phase: 'commands', status: 'ok', count: commands.commands.size }, '🧩 commands loaded');
    startGC(log);
  }

  const version = await lifecycle.fetchVersion();

  sock = makeWASocket({
    version,
    agent:       getWsAgent(),
    fetchAgent:  getWsAgent(),                  
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
    shouldIgnoreJid:     (jid) => jid?.endsWith('@newsletter') || (jid === 'status@broadcast' && !config.features.readStatus),
  });

  sock.ev.on('creds.update', saveCreds);
  store.bind(sock.ev);

  await lifecycle.startLoginFlow(sock);

  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr && (config.login.type || 'QR').toUpperCase() === 'QR') {
      log.info({ phase: 'login', flow: 'QR' }, 'Please scan the QR to begin using EchoFox');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      log.info({ phase: 'ready', status: 'ok', user: sock.user?.id }, 'EchoFox Ready');
      process.send?.('ready');
      reconnectAttempts = 0;

      if (!sock._sendWrapped) {
        wrapSocketSend(sock, { concurrency: config.processing.sendConcurrency || 4 });
        sock._sendWrapped = true;
        log.info({ concurrency: config.processing.sendConcurrency || 4 }, 'outbound send queue wired');
      }

      if (!sock._presenceWrapped) { wrapWithPresence(sock, config) }

      diagnostics.bindRuntimeContext({ sock, store, commands, auth, caches });
      alertEngine.attachSock(sock, config.alerts.notifyChannel || config.channels.errLogs);

      const initialPresence = config.antiBan?.presenceOnConnect || 'available';
      sock.sendPresenceUpdate(initialPresence)
        .then(()  => log.info({ presence: initialPresence }, 'sent initial presence'))
        .catch((e)=> log.debug({ err: e }, 'sendPresenceUpdate at connect failed'));

      if (config.dashboard.enabled && !dashboardStarted) {
        try {
          startDashboard(config.dashboard.port, store, config);
          dashboardStarted = true;
          log.info({ phase: 'dashboard', port: config.dashboard.port }, 'Dashboard started');
        } catch (e) {
          log.error({ err: e }, 'dashboard failed to start');
        }
      }

      try {
        const groups = await sock.groupFetchAllParticipating();
        for (const [jid, meta] of Object.entries(groups)) {
          store.saveGroupMetadata(jid, meta);

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
        log.info({ phase: 'warm', groups: Object.keys(groups).length }, '🔥 group cache warmed + participant snapshot ensured');
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
        log.error({ phase: 'connection', status: 'logged_out' }, 'logged out / forbidden – exiting for re-pair');
        try { 
          if (clear) await clear()
        } catch {}
        process.exit(2);
      }

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;

        const baseDelay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        const jitter = Math.random() * 1500;
        const delay = Math.floor(baseDelay + jitter);

        log.info({ attempt: reconnectAttempts, delay }, 'reconnecting…');

        setTimeout(() => {
          start(reconnectAttempts);
        }, delay);
      } else {
        log.error({ attempts: reconnectAttempts }, 'Max reconnection attempts reached. Exiting...');
        process.exit(1);
      }
    }
  });

  sock.ev.on('messaging-history.set', (payload) => eventRouter.emit('messaging-history.set', { sock, store, payload }));

  sock.ev.on('contacts.update', (updates) => {
    for (const update of updates) {
      if (update.id) {
        caches.userDevicesCache.del(update.id);
        log.debug({ jid: update.id }, 'userDevicesCache invalidated');
      }
    }
  });

  sock.ev.on('group-participants.update', (u) => eventRouter.emit('group-participants.update', { sock, store, u }));
  sock.ev.on('contacts.upsert', (u) => eventRouter.emit('contacts.upsert', { sock, u }));
  sock.ev.on('call',            (u) => eventRouter.emit('call',            { sock, u }));
  sock.ev.on('groups.update',   (u) => eventRouter.emit('groups.update',   { sock, u }));
  sock.ev.on('messages.update',        (payload) => eventRouter.emit('messages.update',        { sock, store, payload }));
  sock.ev.on('messages.delete',        (payload) => eventRouter.emit('messages.delete',        { sock, store, payload }));
  sock.ev.on('messages.reaction',      (payload) => eventRouter.emit('messages.reaction',      { sock, store, payload }));
  sock.ev.on('message-receipt.update', (payload) => eventRouter.emit('message-receipt.update', { sock, store, payload }));
  sock.ev.on('newsletter.upsert', (newsletters) => eventRouter.emit('newsletter.upsert', { sock, newsletters }));
  sock.ev.on('newsletters.update', (updates) => eventRouter.emit('newsletters.update', { sock, updates }));
  
  sock.ev.on('messages.upsert', (payload) => {
    if (!payload?.messages?.length) return;
    metrics.incReceived(payload.messages.length);

    if (payload.type && payload.type !== 'notify') {
      log.debug({ type: payload.type, count: payload.messages.length }, 'Skipping command-routing for non-notify payload.');
      return;
    }
    for (const m of payload.messages) {
      const jid = m?.key?.remoteJid;
      if (!jid) continue;

      const ts = Number(m.messageTimestamp) || 0;
      if (ts && ts < BOT_BOOT_TS - HISTORY_GRACE_SEC) {
        log.debug({ jid, ts, bootTs: BOT_BOOT_TS }, 'Skipping stale message (older than boot)');
        continue;
      }

      queueFor(jid).add(() =>
        eventRouter.handleMessage({ sock, m, commands, store, logger: log })
          .catch((e) => log.error({ err: e, jid }, 'message handler crashed')),
      ).catch(() => {});
    }
  });

  sock.decodeJid = (jid) => (jid ? jidNormalizedUser(jid) : jid);
}

process.on('uncaughtException',  (e) => log.fatal({ err: e }, 'uncaughtException'));
process.on('unhandledRejection', (e) => log.fatal({ err: e }, 'unhandledRejection'));

start().catch((e) => {
  log.fatal({ err: e }, 'failed to start');
  process.exit(1);
});
