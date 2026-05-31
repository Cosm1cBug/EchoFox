/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * axios-with-retry helper. Builds on src/lib/network.js's configuredAxios()
 * by adding exponential-backoff retry on network errors and 5xx/429
 * responses. Drop-in replacement — pass it to commands instead of axios.
 *
 *   const axios = require('../lib/retryAxios').get();
 *   const res = await axios.get('https://api.example.com/x');
 *
 * Idempotent — lazy-initialised on first .get() call. Reads tuning from
 * config.network.fetchTimeoutMs.
 */

const logger = require('../core/logger').child({ mod: 'retry-axios' });

let _instance = null;

function _build() {
  const { configuredAxios } = require('./network');
  const ax = configuredAxios();

  let axiosRetry;
  try { axiosRetry = require('axios-retry'); }
  catch {
    logger.warn('axios-retry not installed — running without retries');
    return ax;
  }

  axiosRetry.default(ax, {
    retries: 3,
    retryDelay: (count) => {
      // Exponential backoff with jitter, capped at 10s.
      const base = 1000 * (2 ** count);
      const jitter = Math.random() * 1000;
      return Math.min(base + jitter, 10_000);
    },
    retryCondition: (err) => {
      // Retry on network errors, idempotent failures, 429, and 5xx.
      if (axiosRetry.default.isNetworkOrIdempotentRequestError(err)) return true;
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return true;
      const status = err.response?.status;
      if (status === 429 || (status >= 500 && status <= 599)) return true;
      return false;
    },
    onRetry: (count, err, cfg) => {
      logger.debug({
        attempt: count, url: cfg.url, method: cfg.method,
        code: err.code, status: err.response?.status,
      }, 'axios retry');
    },
  });

  return ax;
}

function get() {
  if (!_instance) _instance = _build();
  return _instance;
}

module.exports = { get };
