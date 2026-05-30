/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Fixed-metric stats schema.
 *
 *   The original `recordStat(key, inc)` API let any caller increment any
 *   string key — convenient, but typo-prone. We now define an exhaustive
 *   enum of *meaningful* operational metrics. Use src/services/metrics.js
 *   to update them (typed wrappers, no string typos possible).
 *
 *   The old freeform recordStat()/getStats() API on every store still
 *   works — it just reads/writes the same underlying `stats` table. The
 *   typed wrappers in metrics.js delegate to it under the hood.
 *
 * Two flavours of stat:
 *   • counter — monotonically increasing (e.g. messages_received_total)
 *   • gauge   — point-in-time snapshot (e.g. bot_uptime_seconds)
 *
 * Counters live in the `stats` table. Gauges live in `stats_gauges` so
 * they're trivially updateable in place without ON CONFLICT churn.
 */

const COUNTERS = Object.freeze([
  // ── Message flow ────────────────────────────────────────────────────
  'messages_received_total',
  'messages_sent_total',
  // ── Command execution ───────────────────────────────────────────────
  'commands_total',
  'commands_success_total',
  'commands_failed_total',
  'commands_timeout_total',
  // ── Media ───────────────────────────────────────────────────────────
  'media_downloaded_total',
  'media_uploaded_total',
  // ── Throttling ──────────────────────────────────────────────────────
  'rate_limit_hits_total',
  'cooldown_hits_total',
  // ── v0.4.5: stability ──────────────────────────────────────────────
  'heap_pressure_alerts_total',
  'worker_restarts_total',
  'command_alerts_triggered_total',
  'command_alerts_cleared_total',
]);

const GAUGES = Object.freeze([
  'bot_started_at',
  'bot_uptime_seconds',
  'groups_count',
  'unique_users_seen',
  // ── v0.4.5: stability ──────────────────────────────────────────────
  'heap_pressure_percent',
  'active_command_alerts',
]);

/**
 * Per-command counter keys are dynamic — we use the convention:
 *   commands_per_name__<commandName>     (counter, append "_total" optionally)
 *
 * `metrics.incCommand(name, outcome)` writes both the global counter
 * (commands_total / commands_success_total / commands_failed_total /
 * commands_timeout_total) AND the per-command counter.
 */
function commandKey(name) {
  // Sanitize to prevent storage layer surprises: only [a-z0-9_]
  const safe = String(name).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return `commands_per_name__${safe}`;
}

/** Quick validity check used by typed helpers. */
function isCounter(k) { return COUNTERS.includes(k) || k.startsWith('commands_per_name__'); }
function isGauge(k)   { return GAUGES.includes(k); }

const SQL_DDL = {
  sqlite: `
    CREATE TABLE IF NOT EXISTS stats (
      key   TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS stats_gauges (
      key       TEXT PRIMARY KEY,
      value     REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `,
  postgres: `
    CREATE TABLE IF NOT EXISTS stats (
      key   TEXT PRIMARY KEY,
      value BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS stats_gauges (
      key        TEXT PRIMARY KEY,
      value      DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at BIGINT           NOT NULL DEFAULT 0
    );
  `,
};

module.exports = {
  COUNTERS,
  GAUGES,
  commandKey,
  isCounter,
  isGauge,
  SQL_DDL,
};
