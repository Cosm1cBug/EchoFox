/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * levelingDecayService — periodic XP decay for inactive users (v1.16.0).
 *
 * Policy (configurable via config.leveling.decay):
 *   • enabled            (default false; toggle live via $leveling decay on/off)
 *   • afterDays          (default 14; grace period before decay starts)
 *   • percentPerWeek     (default 0.05 = 5%; rate of compounding decay)
 *   • sweepIntervalMinutes (default 1440 = once per day)
 *
 * Algorithm:
 *   For each row in user_levels whose `last_at` is older than
 *   (now - afterDays * 86400) seconds:
 *     weeksOver = (now - last_at - graceSec) / WEEK_SEC
 *     newXp    = floor(xp * (1 - percentPerWeek) ^ weeksOver)
 *     Update the row IFF newXp < xp.
 *
 *   The sweep does NOT touch `last_at` (we don't want to "reset" a user's
 *   inactivity just because the sweep visited them — they're still inactive).
 *
 *   The sweep takes the store-side path: store.applyXpDecay(graceSec, ratePerWeek)
 *   returns the number of rows affected. This keeps the policy expression on
 *   the bot side and lets each store choose the most efficient implementation
 *   (single SQL UPDATE for sqlite/postgres, scan+update for mongo/redis).
 *
 * Runtime toggle:
 *   The bot admin can flip decay on/off live via:
 *     $leveling decay on
 *     $leveling decay off
 *     $leveling status
 *   These mutate config.leveling.decay.enabled in-memory (process-local;
 *   restart reverts to whatever config.js says). Group admins cannot toggle.
 *
 * Sweep lifecycle:
 *   • start(sock) — called once from worker.js boot. Schedules setInterval.
 *   • stop()      — called from worker shutdown (best-effort).
 *   • runOnce()   — exposed for tests + the $leveling admin command to
 *                   trigger a sweep on demand.
 */

const { getStore } = require('../store/instance');
const { config } = require('../lib/configLoader');
const logger = require('../core/logger').child({ mod: 'level-decay' });

let _timer = null;
let _lastRunAt = 0;
let _lastRunAffected = 0;

const MINUTE_MS = 60_000;
const WEEK_SEC = 7 * 24 * 60 * 60;

/**
 * Run one decay pass. Returns the number of affected rows (or 0).
 * Always safe to call: if decay is disabled or the store doesn't
 * support applyXpDecay, it's a no-op.
 */
async function runOnce() {
  const decayCfg = config?.leveling?.decay || {};
  if (!decayCfg.enabled) {
    return { ran: false, reason: 'disabled', affected: 0 };
  }
  const afterDays = Math.max(1, Math.min(365, Number(decayCfg.afterDays) || 14));
  const percentPerWeek = Math.max(0.001, Math.min(0.5, Number(decayCfg.percentPerWeek) || 0.05));
  const store = getStore();
  if (typeof store?.applyXpDecay !== 'function') {
    return { ran: false, reason: 'unsupported_store', affected: 0 };
  }
  const graceSec = afterDays * 86400;
  try {
    const affected = await store.applyXpDecay(graceSec, percentPerWeek);
    _lastRunAt = Date.now();
    _lastRunAffected = Number(affected) || 0;
    if (_lastRunAffected > 0) {
      logger.info(
        { affected: _lastRunAffected, afterDays, percentPerWeek },
        '🍂 xp decay sweep complete',
      );
    } else {
      logger.debug({ afterDays, percentPerWeek }, 'xp decay sweep: nothing to decay');
    }
    return { ran: true, affected: _lastRunAffected };
  } catch (err) {
    logger.warn({ err, afterDays, percentPerWeek }, 'xp decay sweep failed');
    return { ran: false, reason: 'error', error: err.message, affected: 0 };
  }
}

/**
 * Schedule recurring decay sweeps. Idempotent: calling start() twice
 * just preserves the first timer. Honours sweepIntervalMinutes from
 * config (default 24h). The interval is fixed at start time —
 * subsequent config changes via $leveling don't reschedule.
 */
function start() {
  if (_timer) return;
  const decayCfg = config?.leveling?.decay || {};
  const sweepIntervalMin = Math.max(
    15,
    Math.min(10080, Number(decayCfg.sweepIntervalMinutes) || 1440),
  );
  const intervalMs = sweepIntervalMin * MINUTE_MS;
  _timer = setInterval(() => {
    runOnce().catch((err) => logger.error({ err }, 'decay tick crashed'));
  }, intervalMs);
  if (typeof _timer.unref === 'function') _timer.unref();
  logger.info(
    { sweepIntervalMinutes: sweepIntervalMin, enabled: !!decayCfg.enabled },
    '🍂 levelingDecayService started',
  );
}

function stop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

function getStatus() {
  const decayCfg = config?.leveling?.decay || {};
  return {
    enabled: !!decayCfg.enabled,
    afterDays: Number(decayCfg.afterDays) || 14,
    percentPerWeek: Number(decayCfg.percentPerWeek) || 0.05,
    sweepIntervalMinutes: Number(decayCfg.sweepIntervalMinutes) || 1440,
    lastRunAt: _lastRunAt || null,
    lastRunAffected: _lastRunAffected,
    timerActive: !!_timer,
  };
}

/* Test helpers */
function _resetForTests() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  _lastRunAt = 0;
  _lastRunAffected = 0;
}

module.exports = {
  start,
  stop,
  runOnce,
  getStatus,
  WEEK_SEC,
  _resetForTests,
};
