/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Named circuit breakers around external API calls.
 *
 *   const breaker = require('./circuitBreaker').get('piped', fetcher, {
 *     timeout:                  15000,
 *     errorThresholdPercentage: 50,
 *     resetTimeout:             60000,
 *   });
 *
 *   try {
 *     const result = await breaker.fire(query);
 *   } catch (err) {
 *     // err.code === 'EOPENBREAKER' when circuit is open
 *   }
 *
 *   • Wraps any async function; subsequent calls share the breaker.
 *   • When the breaker opens, calls reject instantly with EOPENBREAKER
 *     (no waiting for the wrapped fn to time out).
 *   • Falls back to passthrough if `opossum` isn't installed (warns once).
 *   • Bumps typed metrics:
 *       breaker_<name>_state          gauge (0 closed, 1 open, 2 half)
 *       breaker_<name>_calls_total    counter
 *       breaker_<name>_failures_total counter
 *       breaker_<name>_rejects_total  counter
 *
 *   Use `getStats()` for the dashboard endpoint that will surface these.
 */

const logger  = require('../core/logger').child({ mod: 'circuit' });
const metrics = require('../services/metrics');

let CircuitBreaker = null;
let _opossumWarned = false;

function _tryLoadOpossum() {
  if (CircuitBreaker) return CircuitBreaker;
  try {
    CircuitBreaker = require('opossum');
    logger.info('opossum loaded — circuit breakers active');
  } catch (e) {
    if (!_opossumWarned) {
      _opossumWarned = true;
      logger.warn('opossum not installed — circuit-breaker wrappers pass-through');
    }
    CircuitBreaker = null;
  }
  return CircuitBreaker;
}

// name → { breaker, stats }
const _registry = new Map();

const DEFAULT_OPTS = {
  timeout:                  15_000,
  errorThresholdPercentage: 50,    // ≥50% failures → open
  resetTimeout:             60_000, // half-open after 60s
  rollingCountTimeout:      10_000,
  rollingCountBuckets:      10,
  volumeThreshold:          5,     // need ≥5 calls to evaluate
};

/**
 * get(name, fn, opts?) → breaker
 *
 *   If a breaker named `name` already exists, the fn argument is ignored
 *   (the registered fn is reused). Use this to share one breaker across
 *   many call sites that hit the same upstream.
 */
function get(name, fn, opts = {}) {
  if (!name) throw new Error('circuitBreaker.get: name required');

  const cached = _registry.get(name);
  if (cached) return cached.breaker;

  if (!fn || typeof fn !== 'function') {
    throw new Error(`circuitBreaker.get('${name}'): fn required on first call`);
  }

  const opossum = _tryLoadOpossum();
  if (!opossum) {
    // Pass-through wrapper preserving the .fire() API
    const passthrough = {
      fire: (...args) => fn(...args),
      stats: { name, opossum: false, state: 'closed' },
    };
    _registry.set(name, { breaker: passthrough, stats: passthrough.stats });
    return passthrough;
  }

  const breaker = new opossum(fn, { ...DEFAULT_OPTS, ...opts, name });
  const stats   = { name, opossum: true, state: 'closed', calls: 0, failures: 0, rejects: 0 };
  _registry.set(name, { breaker, stats });

  // Wire metrics
  breaker.on('success', () => { stats.calls++; metrics.inc?.(`breaker_${name}_calls_total`); });
  breaker.on('failure', () => { stats.failures++; metrics.inc?.(`breaker_${name}_failures_total`); });
  breaker.on('reject',  () => { stats.rejects++; metrics.inc?.(`breaker_${name}_rejects_total`); });
  breaker.on('open',    () => { stats.state = 'open';   metrics.setGauge?.(`breaker_${name}_state`, 1); logger.warn({ name }, '🔌 circuit OPENED'); });
  breaker.on('halfOpen',() => { stats.state = 'half';   metrics.setGauge?.(`breaker_${name}_state`, 2); logger.info({ name }, '🔌 circuit HALF-OPEN'); });
  breaker.on('close',   () => { stats.state = 'closed'; metrics.setGauge?.(`breaker_${name}_state`, 0); logger.info({ name }, '🔌 circuit CLOSED'); });

  return breaker;
}

/** Returns all registered breakers' stats (for dashboard). */
function getStats() {
  return Array.from(_registry.entries()).map(([name, e]) => ({ ...e.stats, name }));
}

/** For tests: reset registry. */
function _reset() { _registry.clear(); }

module.exports = { get, getStats, _reset };
