/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Runtime leak detector.
 *
 *   Samples heap usage every config.runtime.leakDetection.sampleIntervalMs
 *   and keeps a rolling N-sample window (default 144 = 24h at 10min/sample).
 *   On each sample, checks for monotonic growth: if the LAST half of the
 *   window has higher MIN heap than the FIRST half's MAX heap, that
 *   signals a leak.
 *
 *   When triggered:
 *     • Emits a structured warn log with the trend
 *     • Bumps metrics.inc('leak_alerts_total')
 *     • Sets a gauge 'leak_suspected' = 1 (cleared on next non-trigger sample)
 *
 *   This is COMPLEMENTARY to memoryGuard:
 *     • memoryGuard catches SUDDEN heap spikes (instantaneous %)
 *     • leakDetector catches SLOW growth over hours
 */

const { config } = require('./configLoader');
const logger     = require('../core/logger').child({ mod: 'leak-detector' });

let _timer  = null;
let _samples = [];   // [{ ts, heapUsedMB }]
let _alerted = false;

function _trend() {
  if (_samples.length < 4) return null;
  const mid = Math.floor(_samples.length / 2);
  const firstHalf = _samples.slice(0, mid);
  const lastHalf  = _samples.slice(mid);
  const firstMax  = Math.max(...firstHalf.map((s) => s.heapUsedMB));
  const lastMin   = Math.min(...lastHalf.map((s) => s.heapUsedMB));
  const growthMB  = lastMin - firstMax;
  const growthPct = firstMax > 0 ? (growthMB / firstMax) * 100 : 0;
  return { firstMax, lastMin, growthMB, growthPct, samples: _samples.length };
}

function _maybeAlert(metrics) {
  const t = _trend();
  if (!t) return;

  const threshold = config.runtime?.leakDetection?.growthThresholdPercent ?? 30;
  const triggered = t.lastMin > t.firstMax && t.growthPct >= threshold;

  if (triggered && !_alerted) {
    _alerted = true;
    logger.warn({ ...t, threshold }, '🔥 monotonic heap growth detected — possible leak');
    try { metrics.inc?.('leak_alerts_total'); metrics.setGauge?.('leak_suspected', 1); } catch {}
  } else if (!triggered && _alerted) {
    _alerted = false;
    logger.info(t, 'heap growth recovered');
    try { metrics.setGauge?.('leak_suspected', 0); } catch {}
  }
}

function start(opts = {}) {
  if (_timer) return { stop };
  if (config.runtime?.leakDetection?.enabled === false) {
    logger.info('leak detector disabled in config');
    return { stop };
  }

  const interval = opts.sampleIntervalMs
    ?? config.runtime?.leakDetection?.sampleIntervalMs
    ?? 10 * 60 * 1000;            // 10 minutes
  const windowSize = opts.windowSize
    ?? config.runtime?.leakDetection?.windowSize
    ?? 144;                       // 24h at 10min/sample

  const metrics = require('../services/metrics');

  _timer = setInterval(() => {
    try {
      const mem = process.memoryUsage();
      _samples.push({ ts: Date.now(), heapUsedMB: Math.round(mem.heapUsed / 1e6) });
      if (_samples.length > windowSize) _samples.shift();
      metrics.setGauge?.('heap_used_mb', Math.round(mem.heapUsed / 1e6));
      _maybeAlert(metrics);
    } catch (err) {
      logger.debug({ err }, 'leak detector sample failed');
    }
  }, interval);
  _timer.unref?.();

  logger.info({ intervalMs: interval, windowSize }, 'leak detector started');
  return { stop };
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _samples = [];
  _alerted = false;
}

// Exposed for tests
function _samplesForTest() { return _samples.slice(); }
function _injectSampleForTest(heapUsedMB) {
  _samples.push({ ts: Date.now(), heapUsedMB });
  if (_samples.length > 1000) _samples.shift();
}
function _resetForTests() { _samples = []; _alerted = false; }

module.exports = { start, stop, _trend: () => _trend(), _samplesForTest, _injectSampleForTest, _resetForTests };