/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';

/**
 * Diagnostics: tests every major subsystem and returns a single JSON
 * report. Used by:
 *   • dashboard endpoint /api/diagnostics
 *   • .healthcheck admin command
 *   • bootstrap /healthz (cheap-checks-only subset)
 *
 * Each check has a 2-second budget. Failures are caught and reported
 * — diagnostics NEVER throws.
 *
 * Subsystems tested:
 *   • baileys socket  — connected? sock.user populated?
 *   • store           — read/write round-trip
 *   • auth            — credentials loaded? saveCreds exposed?
 *   • commands        — registry loaded? counts?
 *   • caches          — populated?
 *   • config          — source + age
 *   • metrics         — counter readable?
 *   • host            — memory + uptime
 *   • network         — proxy config + Baileys WS agent
 *   • alerts          — engine state + flagged commands
 *
 * Return shape:
 *   {
 *     ok: boolean,
 *     ts: <epoch>,
 *     checks: {
 *       <name>: { ok, ms, details?, error? }
 *     }
 *   }
 */

const { config } = require('./configLoader');
const logger     = require('../core/logger').child({ mod: 'diagnostics' });
const CHECK_TIMEOUT_MS = 2000;

function withTimeout(p, ms) {
  let t;
  const timer = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`check timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

async function timedCheck(name, fn) {
  const t0 = Date.now();
  try {
    const details = await withTimeout(Promise.resolve(fn()), CHECK_TIMEOUT_MS);
    return { ok: true, ms: Date.now() - t0, details: details || undefined };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, error: err.message || String(err) };
  }
}

/**
 * Run full diagnostics.
 *   ctx = { sock, store, commands, auth, caches }
 *   opts.cheap = true → skip expensive checks (used by /healthz)
 */
async function runDiagnostics(ctx = {}, opts = {}) {
  const { sock, store, commands, auth, caches } = ctx;
  const cheap = !!opts.cheap;

  const checks = {};

  // ─── config (instant) ───────────────────────────────────────────────
  checks.config = await timedCheck('config', () => ({
    source: config.__meta?.source || 'unknown',
    loadedAt: config.__meta?.loadedAt,
    botName: config.bot.name,
    storeBackend: config.storeDB.type,
    authBackend:  config.auth.method,
    loginType:    config.login.type,
  }));

  // ─── host (instant) ────────────────────────────────────────────────
  checks.host = await timedCheck('host', () => {
    const mem = process.memoryUsage();
    return {
      uptimeSec:        Math.floor(process.uptime()),
      rssBytes:         mem.rss,
      heapUsedBytes:    mem.heapUsed,
      heapTotalBytes:   mem.heapTotal,
      heapPercent:      Math.round((mem.heapUsed / mem.heapTotal) * 100),
      pid:              process.pid,
      nodeVersion:      process.version,
    };
  });

  // ─── baileys socket ────────────────────────────────────────────────
  checks.baileys = await timedCheck('baileys', () => {
    if (!sock) throw new Error('no sock instance');
    if (!sock.user) throw new Error('socket exists but no user (not yet connected)');
    return {
      connected: true,
      userJid:   sock.user.id,
      pushName:  sock.user.name || '(none)',
      sendQueueDepth: typeof sock.sendMessage?.queueSize === 'function'
        ? sock.sendMessage.queueSize() : null,
    };
  });

  // ─── auth backend ──────────────────────────────────────────────────
  checks.auth = await timedCheck('auth', () => {
    if (!auth) throw new Error('no auth handle');
    return {
      backend: config.auth.method,
      hasCreds: !!auth?.state?.creds,
      hasSaveCreds: typeof auth?.saveCreds === 'function',
      registered: !!auth?.state?.creds?.registered,
    };
  });

  // ─── store ─────────────────────────────────────────────────────────
  if (!cheap) {
    checks.store = await timedCheck('store', async () => {
      if (!store) throw new Error('no store handle');
      // round-trip a no-op gauge to test write-then-read
      const probeKey = '__diagnostics_probe__';
      const ts = Math.floor(Date.now() / 1000);
      await store.setGauge?.(probeKey, ts);
      const all = await store.getGauges?.();
      const echoed = all && all[probeKey] === ts;
      const counters = await store.getStats?.();
      const counterCount = counters ? Object.keys(counters).length : 0;
      const gaugeCount   = all     ? Object.keys(all).length      : 0;
      return {
        backend:      config.storeDB.type,
        roundTrip:    echoed ? 'ok' : 'wrote but read-back mismatched',
        counters:     counterCount,
        gauges:       gaugeCount,
      };
    });
  }

  // ─── commands registry ─────────────────────────────────────────────
  checks.commands = await timedCheck('commands', () => {
    if (!commands) throw new Error('no commands registry');
    return {
      loaded:     commands.commands?.size  || 0,
      aliases:    commands.aliases?.size   || 0,
      categories: commands.categories?.size || 0,
      skipped:    Array.isArray(commands.skipped) ? commands.skipped.length : 0,
    };
  });

  // ─── caches ────────────────────────────────────────────────────────
  checks.caches = await timedCheck('caches', () => {
    if (!caches) return { configured: false };
    const out = {};
    for (const name of ['groupMetadataCache','msgRetryCounterCache','callOfferCache',
                        'placeholderResendCache','userDevicesCache','mediaCache',
                        'parseCache','profilePicCache']) {
      const c = caches[name];
      if (!c) continue;
      out[name] = typeof c.size === 'number' ? c.size :
                  typeof c.size === 'function' ? c.size() :
                  typeof c.getStats === 'function' ? c.getStats() : 'unknown';
    }
    return out;
  });

  // ─── metrics service ───────────────────────────────────────────────
  checks.metrics = await timedCheck('metrics', async () => {
    const m = require('../services/metrics');
    const snap = await m.snapshot();
    return {
      countersTracked: Object.keys(snap.counters || {}).length,
      gaugesTracked:   Object.keys(snap.gauges   || {}).length,
      uptimeSec:       snap.gauges?.bot_uptime_seconds || 0,
    };
  });

  // ─── network ──────────────────────────────────────────────────────
  checks.network = await timedCheck('network', () => {
    let wsAgent = null;
    try { wsAgent = require('./network').getWsAgent(); } catch {}
    return {
      proxyConfigured: !!(config.network?.httpsProxy || config.network?.httpProxy || config.network?.socksProxy),
      extraCAs:        !!config.network?.extraCaCertPath,
      wsAgent:         wsAgent ? 'set' : 'default',
      userAgent:       config.network?.userAgent || '',
    };
  });

  // ─── alerts engine ────────────────────────────────────────────────
  checks.alerts = await timedCheck('alerts', () => {
    let engine = null;
    try { engine = require('../services/alertEngine'); } catch {}
    if (!engine || typeof engine.getActiveAlerts !== 'function') {
      return { initialized: false };
    }
    const active = engine.getActiveAlerts();
    return {
      initialized: true,
      activeCount: active.length,
      commandsBelowThreshold: active.map((a) => a.command),
    };
  });

  // ─── Aggregate ─────────────────────────────────────────────────────
  const ok = Object.values(checks).every((c) => c.ok);
  return { ok, ts: Math.floor(Date.now() / 1000), checks };
}

// In-memory handle of last-seen context so the dashboard endpoint can
// call diagnostics without needing to be passed those handles every
// request. Set once at worker boot.
let _ctx = {};
function bindRuntimeContext(ctx) {
  _ctx = ctx;
  logger.info('diagnostics runtime context bound');
}
function getRuntimeContext() { return _ctx; }

module.exports = {
  runDiagnostics,
  bindRuntimeContext,
  getRuntimeContext,
};
