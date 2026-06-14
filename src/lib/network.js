/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Centralised outbound-networking concerns:
 *
 *   • Proxy agents (HTTP, HTTPS, SOCKS) built from config.network
 *   • Extra CA certificates loaded from a PEM file path
 *   • Tuned axios instance (timeout + UA + agents)
 *   • A `getWsAgent()` helper used by Baileys' `agent` socket option
 *
 *   All side-effect-free — caller decides where to apply.
 *
 *   If proxy fields are empty, getProxyAgents() returns nulls and
 *   configuredAxios() returns a vanilla axios instance.
 *
 *   noProxy hosts: passed-through pattern match (substring). For real
 *   CIDR matching install `proxy-from-env` later.
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const tls = require('node:tls');

const { config } = require('./configLoader');
const logger = require('../core/logger').child({ mod: 'network' });

let _extraCAs = null;
let _httpAgent = null;
let _httpsAgent = null;
let _socksAgent = null;
let _wsAgent = null;
let _axios = null;

// ─── Extra CA bundle loading ─────────────────────────────────────────────
function loadExtraCAs() {
  if (_extraCAs !== null) return _extraCAs;
  const p = config.network?.extraCaCertPath;
  if (!p) {
    _extraCAs = [];
    return _extraCAs;
  }
  try {
    const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    const pem = fs.readFileSync(abs, 'utf8');
    // Concatenated PEM bundle — split each cert.
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
    _extraCAs = blocks;
    logger.info({ path: abs, count: blocks.length }, 'extra CA certs loaded');
    return _extraCAs;
  } catch (e) {
    logger.warn({ err: e, path: p }, 'failed to load extraCaCertPath; continuing without');
    _extraCAs = [];
    return _extraCAs;
  }
}

/** Build a tls.SecureContext options object suitable for `ca:` in https agents. */
function makeCAOption() {
  const extra = loadExtraCAs();
  if (!extra.length) return undefined;
  return [...tls.rootCertificates, ...extra];
}

// ─── Proxy agents ────────────────────────────────────────────────────────
function getProxyAgents() {
  // Idempotent — only build once
  if (_httpsAgent || _httpAgent || _socksAgent) {
    return { httpAgent: _httpAgent, httpsAgent: _httpsAgent, socksAgent: _socksAgent };
  }

  const ca = makeCAOption();
  const net = config.network || {};

  // SOCKS takes precedence over HTTP(S) proxy if both are set.
  if (net.socksProxy) {
    try {
      const { SocksProxyAgent } = require('socks-proxy-agent');
      _socksAgent = new SocksProxyAgent(net.socksProxy);
      logger.info(
        { proxy: net.socksProxy.replace(/\/\/[^@]*@/, '//***@') },
        'SOCKS proxy agent created',
      );
      // SOCKS works for both http and https
      _httpAgent = _socksAgent;
      _httpsAgent = _socksAgent;
      return { httpAgent: _httpAgent, httpsAgent: _httpsAgent, socksAgent: _socksAgent };
    } catch (e) {
      logger.error({ err: e }, 'SOCKS agent failed to load — install `socks-proxy-agent`');
    }
  }

  // HTTP(S) proxy
  if (net.httpsProxy || net.httpProxy) {
    try {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      const { HttpProxyAgent } = require('http-proxy-agent');

      if (net.httpsProxy) {
        _httpsAgent = new HttpsProxyAgent(net.httpsProxy, { ca });
        logger.info(
          { proxy: net.httpsProxy.replace(/\/\/[^@]*@/, '//***@') },
          'HTTPS proxy agent created',
        );
      } else if (ca) {
        // No proxy but have extra CAs → still build a stock https agent with CAs
        _httpsAgent = new https.Agent({ ca });
      }

      if (net.httpProxy) {
        _httpAgent = new HttpProxyAgent(net.httpProxy);
        logger.info(
          { proxy: net.httpProxy.replace(/\/\/[^@]*@/, '//***@') },
          'HTTP proxy agent created',
        );
      }
    } catch (e) {
      logger.error(
        { err: e },
        'HTTP(S) proxy agents failed to load — install `https-proxy-agent` and `http-proxy-agent`',
      );
    }
  } else if (ca) {
    // No proxy at all, but we still need a CA-aware agent for axios
    _httpsAgent = new https.Agent({ ca });
  }

  return { httpAgent: _httpAgent, httpsAgent: _httpsAgent, socksAgent: _socksAgent };
}

/**
 * Returns ONE agent suitable for Baileys' `agent:` socket option.
 *   • SOCKS proxy → SocksProxyAgent
 *   • HTTPS proxy → HttpsProxyAgent
 *   • Otherwise   → undefined (Baileys uses its default)
 */
function getWsAgent() {
  if (_wsAgent !== undefined) return _wsAgent;
  const { httpsAgent, socksAgent } = getProxyAgents();
  _wsAgent = socksAgent || httpsAgent || undefined;
  return _wsAgent;
}

// ─── Configured axios instance ───────────────────────────────────────────
/**
 * Returns a shared axios instance with:
 *   • timeout from config.network.fetchTimeoutMs
 *   • configured proxy agents
 *   • extra CAs honored
 *   • bot User-Agent header
 *
 * Use this everywhere instead of `require('axios')` directly if you
 * want commands + services to honor network config uniformly.
 */
function configuredAxios() {
  if (_axios) return _axios;
  const axios = require('axios');
  const { httpAgent, httpsAgent } = getProxyAgents();
  const net = config.network || {};
  _axios = axios.create({
    timeout: net.fetchTimeoutMs || 30_000,
    headers: { 'User-Agent': net.userAgent || 'EchoFox/0.4' },
    httpAgent,
    httpsAgent,
    proxy: false, // ← we use agents directly; tell axios to skip
  });
  return _axios;
}

/**
 * Apply extra CAs globally to Node's TLS defaults so libraries that
 * bypass our axios instance (e.g. node-fetch, undici) still benefit.
 * Call once at boot — idempotent.
 */
function applyExtraCAsToProcess() {
  const extras = loadExtraCAs();
  if (!extras.length) return false;
  // Concatenate Node's bundle + extras into NODE_EXTRA_CA_CERTS-equivalent.
  // Mutating process env after start has no effect, so we patch
  // tls.createSecureContext to merge our extras into every new context.
  const origCreate = tls.createSecureContext;
  tls.createSecureContext = function patchedCreate(opts = {}) {
    const ctx = origCreate.call(tls, opts);
    for (const cert of extras) {
      try {
        ctx.context.addCACert(cert);
      } catch (_e) {
        /* dup or fmt */
      }
    }
    return ctx;
  };
  logger.info({ count: extras.length }, 'extra CAs applied process-wide');
  return true;
}

function axiosWithBreaker(name, axiosCfg, breakerOpts = {}) {
  const { get: getBreaker } = require('./circuitBreaker');
  const ax = configuredAxios();
  const breaker = getBreaker(name, (cfg) => ax.request(cfg), breakerOpts);
  return breaker.fire(axiosCfg);
}

function isOpenBreakerError(err) {
  if (!err) return false;
  if (err.code === 'EOPENBREAKER') return true;
  if (typeof err.message === 'string' && /breaker is open/i.test(err.message)) return true;
  return false;
}

module.exports = {
  loadExtraCAs,
  getProxyAgents,
  getWsAgent,
  configuredAxios,
  applyExtraCAsToProcess,
  axiosWithBreaker,
  isOpenBreakerError,
};
