/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';

/**
 * Memory pressure guard.
 *
 *   Periodically samples heap usage. If pressure exceeds the threshold:
 *     • bump the `heap_pressure_alerts_total` counter (visible in dashboard)
 *     • emit a structured warn log
 *     • optionally exit the worker so the supervisor restarts it fresh
 *
 *   The supervisor's exponential-backoff respawn means an OOM-prone
 *   worker is automatically recovered without losing the health
 *   endpoint or restart history.
 *
 *   Config (config.runtime):
 *     maxHeapPercent  → threshold (0-100), default 90
 *     autoRestart     → boolean, default true
 *     checkIntervalMs → default 30_000
 *     graceMs         → wait between detection and exit (default 5000),
 *                       lets in-flight commands finish.
 *
 *   Returns a stop() function in case caller wants to disable later.
 */

const logger  = require('../core/logger').child({ mod: 'memguard' });
const metrics = require('../services/metrics');

function startMemoryGuard(opts = {}) {
  const cfg = opts.config?.runtime || {};
  const thresholdPct  = Math.max(50, Math.min(100, cfg.maxHeapPercent ?? 90));
  const autoRestart   = cfg.autoRestart !== false;          // default true
  const checkEvery    = Math.max(5_000, cfg.checkIntervalMs ?? 30_000);
  const graceMs       = Math.max(1_000, cfg.gracePeriodMs   ?? 5000);

  let triggered = false;
  let consecutiveBreaches = 0;

  const tick = () => {
    try {
      const mem = process.memoryUsage();
      const pct = (mem.heapUsed / mem.heapTotal) * 100;
      // Always update the gauge so the dashboard reflects current pressure.
      try { metrics.setGauge?.('heap_pressure_percent', Math.round(pct)); } catch {}

      if (pct < thresholdPct) {
        consecutiveBreaches = 0;
        return;
      }
      consecutiveBreaches++;

      // Require 2 consecutive breaches before action — avoids GC-spike false positives.
      if (consecutiveBreaches < 2) {
        logger.warn({ heapPct: Math.round(pct), threshold: thresholdPct }, 'heap pressure (1/2)');
        return;
      }

      if (triggered) return;
      triggered = true;

      try { metrics.inc?.('heap_pressure_alerts_total'); } catch {}

      logger.error({
        heapPct: Math.round(pct),
        threshold: thresholdPct,
        rssMB: Math.round(mem.rss / 1e6),
        heapUsedMB: Math.round(mem.heapUsed / 1e6),
        heapTotalMB: Math.round(mem.heapTotal / 1e6),
        autoRestart,
      }, '🔥 heap pressure threshold exceeded');

      if (!autoRestart) {
        // Reset so we re-alert on the next sustained breach.
        setTimeout(() => { triggered = false; }, 5 * 60 * 1000);
        return;
      }

      logger.warn({ graceMs }, 'auto-restarting worker via process.exit(3) after grace period');
      // exit code 3 = "memory pressure restart" (informational only).
      setTimeout(() => process.exit(3), graceMs);
    } catch (e) {
      logger.debug({ err: e }, 'tick failed');
    }
  };

  const timer = setInterval(tick, checkEvery);
  timer.unref();
  logger.info({ thresholdPct, autoRestart, checkEvery, graceMs }, 'memory guard armed');

  return () => clearInterval(timer);
}

module.exports = { startMemoryGuard };
