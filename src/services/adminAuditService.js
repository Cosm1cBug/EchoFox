/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * adminAuditService — append-only log of privileged command invocations (v1.17.0).
 *
 * Records (best-effort, fire-and-forget):
 *   • Any command invoked with the `$` admin prefix (config.bot.adminPrefix)
 *   • Any command exporting `admin: true`
 *   • Any command exporting `groupAdminOnly: true` — invoked by a group admin
 *     in their group (i.e. an actual moderation action by a group admin)
 *
 * The runner calls `record({ ... })` after the command completes (or after
 * we know we're going to deny it). Writes are async + fail-closed — a
 * store error never blocks command execution.
 *
 * Pruning:
 *   `startPrune()` schedules a once-per-day sweep that deletes rows older
 *   than `config.audit.retentionDays` (default 90). Idempotent + unref'd.
 *
 * Public API:
 *   record(entry)               → fire-and-forget audit write
 *   shouldAudit(cmd, isAdminCall, isGroupAdmin)
 *                              → boolean: should this invocation be logged?
 *   pruneOnce()                → manual sweep (returns # deleted)
 *   startPrune()               → schedule the recurring sweep
 *   stop()                     → clear the timer
 *   getStatus()                → for $audit / dashboard health
 */

const { getStore } = require('../store/instance');
const { config } = require('../lib/configLoader');
const logger = require('../core/logger').child({ mod: 'audit' });
const metrics = require('./metrics');

const DEFAULT_RETENTION_DAYS = 90;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

let _timer = null;
let _lastPruneAt = 0;
let _lastPruneDeleted = 0;

/**
 * shouldAudit — decision predicate the runner uses to decide whether to
 * write an audit row. Pulled out for unit-testability.
 */
function shouldAudit(cmd, isAdminCall, isGroupAdmin) {
  if (!cmd) return false;
  if (isAdminCall) return true;
  if (cmd.admin === true) return true;
  if (cmd.groupAdminOnly === true && isGroupAdmin) return true;
  return false;
}

/**
 * record — fire-and-forget audit write.
 *
 *   entry = {
 *     ts:          optional (defaults to now)
 *     actor_jid:   required
 *     chat_jid:    optional
 *     cmd_name:    required
 *     prefix:      optional ('$' / '.' / ...)
 *     args:        optional string (will be truncated to 500 chars by store)
 *     kind:        'admin' | 'group_admin'
 *     outcome:     'success' | 'failure' | 'timeout' | 'denied'
 *     latency_ms:  optional
 *   }
 */
function record(entry) {
  // Never await — keep this fire-and-forget so the runner doesn't pay
  // a round trip to the store on every admin call.
  (async () => {
    try {
      const store = getStore();
      if (typeof store?.recordAdminAudit !== 'function') return;
      await store.recordAdminAudit(entry);
      try {
        metrics.incAdminAudit();
      } catch (_) {
        /* never block */
      }
    } catch (err) {
      logger.debug({ err, entry }, 'audit write failed (fail-closed)');
    }
  })().catch(() => {});
}

/**
 * pruneOnce — delete audit rows older than retentionDays. Returns count.
 * Safe to call at any time; emits metrics on completion.
 */
async function pruneOnce() {
  const retention = Math.max(
    1,
    Math.min(3650, Number(config?.audit?.retentionDays) || DEFAULT_RETENTION_DAYS),
  );
  const cutoffSec = Math.floor(Date.now() / 1000) - retention * 86400;
  const store = getStore();
  if (typeof store?.pruneAdminAuditOlderThan !== 'function') {
    return { ran: false, reason: 'unsupported_store', deleted: 0 };
  }
  try {
    const deleted = await store.pruneAdminAuditOlderThan(cutoffSec);
    _lastPruneAt = Date.now();
    _lastPruneDeleted = Number(deleted) || 0;
    try {
      metrics.incAdminAuditPrune(_lastPruneDeleted);
      if (typeof store.countAdminAudit === 'function') {
        const n = await store.countAdminAudit();
        metrics.setAdminAuditRows(n);
      }
    } catch (_) {
      /* never block */
    }
    if (_lastPruneDeleted > 0) {
      logger.info(
        { deleted: _lastPruneDeleted, retentionDays: retention },
        '🧹 admin audit prune complete',
      );
    } else {
      logger.debug({ retentionDays: retention }, 'admin audit prune: nothing to delete');
    }
    return { ran: true, deleted: _lastPruneDeleted, retentionDays: retention };
  } catch (err) {
    logger.warn({ err, retention }, 'admin audit prune failed');
    return { ran: false, reason: 'error', error: err.message, deleted: 0 };
  }
}

function startPrune() {
  if (_timer) return;
  _timer = setInterval(() => {
    pruneOnce().catch((err) => logger.error({ err }, 'audit prune tick crashed'));
  }, PRUNE_INTERVAL_MS);
  if (typeof _timer.unref === 'function') _timer.unref();
  logger.info({ intervalMs: PRUNE_INTERVAL_MS }, '🧹 adminAuditService prune started');
}

function stop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

function getStatus() {
  return {
    retentionDays: Math.max(
      1,
      Math.min(3650, Number(config?.audit?.retentionDays) || DEFAULT_RETENTION_DAYS),
    ),
    timerActive: !!_timer,
    lastPruneAt: _lastPruneAt || null,
    lastPruneDeleted: _lastPruneDeleted,
  };
}

function _resetForTests() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  _lastPruneAt = 0;
  _lastPruneDeleted = 0;
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  shouldAudit,
  record,
  pruneOnce,
  startPrune,
  stop,
  getStatus,
  _resetForTests,
};
