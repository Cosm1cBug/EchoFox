/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';

/**
 * Per-command failure-rate alert engine.
 *
 *   Rolling 1-hour window of (success / failure / timeout) outcomes per
 *   command. Surfaces a command as ACTIVE when:
 *
 *     • total invocations in window ≥ minInvocations  (default 10)
 *     • failureRate ≥ failureRateThreshold            (default 0.30)
 *
 *   On state changes (idle→active, active→idle) we:
 *     • emit a log line
 *     • post to config.channels.errLogs once
 *     • bump a counter so the dashboard can show alert pulses
 *
 *   The engine is a thin wrapper around a tumbling buckets array;
 *   memory is bounded by `windowMinutes × 1 bucket/minute` (default 60
 *   buckets per command).
 *
 *   API:
 *     record(cmdName, outcome)    'success' | 'failure' | 'timeout'
 *     getRate(cmdName) → { invocations, failures, rate }
 *     getActiveAlerts()           → [{ command, rate, invocations, since }]
 *     subscribe(fn)               → fn called on every state change
 *     unsubscribe(fn)
 *     stop()                      → halt sweeper
 */

const { LRUCache } = require('lru-cache');
const logger  = require('../core/logger').child({ mod: 'alerts' });
const metrics = require('./metrics');

const WINDOW_MINUTES_DEFAULT     = 60;
const MIN_INVOCATIONS_DEFAULT    = 10;
const FAILURE_RATE_DEFAULT       = 0.30;
const SWEEP_INTERVAL_MS_DEFAULT  = 30_000;

let _state = null;     // { buckets, active, subscribers, opts, sweepTimer, sock }

function _ensure() {
  if (_state) return _state;
  init({});
  return _state;
}

/** Initialise (call once at boot). Passing sock enables errLogs posts. */
function init(opts = {}) {
  const o = {
    windowMinutes:        opts.windowMinutes        ?? WINDOW_MINUTES_DEFAULT,
    minInvocations:       opts.minInvocations       ?? MIN_INVOCATIONS_DEFAULT,
    failureRateThreshold: opts.failureRateThreshold ?? FAILURE_RATE_DEFAULT,
    sweepIntervalMs:      opts.sweepIntervalMs      ?? SWEEP_INTERVAL_MS_DEFAULT,
  };
  _state = {
    opts: o,
    // command → bucket map. Each bucket = { minute: epochMin, success, failure, timeout }
    cmds: new LRUCache({ max: 1000, ttl: o.windowMinutes * 60_000 * 2 }),
    active: new Map(),   // command → { since, rate, invocations }
    subscribers: new Set(),
    sweepTimer: null,
    sock: opts.sock || null,
    channelJid: opts.channelJid || '',
  };
  // periodic sweep evicts expired buckets + recomputes active set
  _state.sweepTimer = setInterval(_sweep, o.sweepIntervalMs);
  _state.sweepTimer.unref();
  logger.info(o, 'alert engine initialised');
  return _state;
}

function attachSock(sock, channelJid) {
  const st = _ensure();
  st.sock = sock;
  st.channelJid = channelJid || '';
}

function subscribe(fn)   { _ensure().subscribers.add(fn); }
function unsubscribe(fn) { _ensure().subscribers.delete(fn); }

function stop() {
  if (!_state) return;
  clearInterval(_state.sweepTimer);
  _state = null;
}

// ─── Record an outcome ───────────────────────────────────────────────────
function record(cmdName, outcome) {
  if (!cmdName || !outcome) return;
  const st = _ensure();
  const minuteNow = Math.floor(Date.now() / 60_000);
  const list = st.cmds.get(cmdName) || [];
  let bucket = list[list.length - 1];
  if (!bucket || bucket.minute !== minuteNow) {
    bucket = { minute: minuteNow, success: 0, failure: 0, timeout: 0 };
    list.push(bucket);
  }
  bucket[outcome] = (bucket[outcome] || 0) + 1;

  // trim oldest buckets outside window
  const oldest = minuteNow - st.opts.windowMinutes + 1;
  while (list.length && list[0].minute < oldest) list.shift();
  st.cmds.set(cmdName, list);

  _evaluate(cmdName);
}

// ─── Compute current rate over rolling window ────────────────────────────
function getRate(cmdName) {
  const st = _ensure();
  const list = st.cmds.get(cmdName) || [];
  const minuteNow = Math.floor(Date.now() / 60_000);
  const oldest = minuteNow - st.opts.windowMinutes + 1;
  let success = 0, failure = 0, timeout = 0;
  for (const b of list) {
    if (b.minute < oldest) continue;
    success += b.success;
    failure += b.failure;
    timeout += b.timeout;
  }
  const invocations = success + failure + timeout;
  const fails       = failure + timeout;
  return {
    invocations,
    failures: fails,
    rate: invocations > 0 ? fails / invocations : 0,
  };
}

function getActiveAlerts() {
  const st = _ensure();
  return [...st.active.entries()].map(([command, info]) => ({
    command,
    rate:        info.rate,
    invocations: info.invocations,
    since:       info.since,
  }));
}

function _evaluate(cmdName) {
  const st = _ensure();
  const { invocations, failures, rate } = getRate(cmdName);
  const meetsMin   = invocations >= st.opts.minInvocations;
  const exceedsRt  = rate >= st.opts.failureRateThreshold;
  const isCurrentlyActive = st.active.has(cmdName);

  if (meetsMin && exceedsRt && !isCurrentlyActive) {
    const info = { rate, invocations, failures, since: Math.floor(Date.now() / 1000) };
    st.active.set(cmdName, info);
    try { metrics.inc?.('command_alerts_triggered_total'); } catch {}
    logger.warn({ cmd: cmdName, rate: rate.toFixed(2), invocations, failures },
      '🚨 command failure-rate alert TRIGGERED');
    _notify('triggered', cmdName, info);
  } else if ((!meetsMin || !exceedsRt) && isCurrentlyActive) {
    const info = st.active.get(cmdName);
    st.active.delete(cmdName);
    try { metrics.inc?.('command_alerts_cleared_total'); } catch {}
    logger.info({ cmd: cmdName, rate: rate.toFixed(2), invocations },
      '✅ command failure-rate alert CLEARED');
    _notify('cleared', cmdName, info);
  } else if (isCurrentlyActive) {
    // Update the in-place rate snapshot
    const info = st.active.get(cmdName);
    info.rate = rate;
    info.invocations = invocations;
  }
}

function _sweep() {
  const st = _ensure();
  // Re-evaluate everything periodically so commands that stop running
  // get cleared once their invocation count drops below the threshold.
  for (const cmdName of st.active.keys()) _evaluate(cmdName);
}

function _notify(kind, command, info) {
  const st = _state;
  if (!st) return;

  // 1. subscribers (in-process listeners, e.g. dashboard SSE in the future)
  for (const fn of st.subscribers) {
    try { fn({ kind, command, info }); } catch {}
  }

  // 2. errLogs channel (if available)
  if (!st.sock || !st.channelJid) return;
  const msg = kind === 'triggered'
    ? `🚨 *Command alert — TRIGGERED*\n*Cmd:* \`${command}\`\n*Failure rate:* ${(info.rate * 100).toFixed(0)}% over last 1h\n*Invocations:* ${info.invocations}`
    : `✅ *Command alert — CLEARED*\n*Cmd:* \`${command}\`\n*Invocations in window:* ${info?.invocations || 0}`;
  st.sock.sendMessage(st.channelJid, { text: msg }, { skipPresence: true }).catch(() => {});
}

module.exports = {
  init,
  attachSock,
  record,
  getRate,
  getActiveAlerts,
  subscribe,
  unsubscribe,
  stop,
};
