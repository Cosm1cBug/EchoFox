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
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');

const { config } = require('./configLoader');
const logger = require('../core/logger').child({ mod: 'network' });

let _extraCAs = null;
let _httpAgent = null;
let _httpsAgent = null;
let _socksAgent = null;
let _wsAgent;
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
    // A requested trust configuration must not silently fall back to another one.
    throw new Error('Cannot load configured extra CA certificates');
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
      throw new Error('Cannot initialize configured SOCKS proxy; request denied');
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
      throw new Error('Cannot initialize configured HTTP(S) proxy; request denied');
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
    // Reject redirects by default: a 302 is the standard way to bypass an
    // SSRF host check (checked host -> redirect -> 169.254.169.254). Callers
    // that genuinely need redirects opt in explicitly (e.g. `.mediafire`
    // sets maxRedirects: 5).
    maxRedirects: 0,
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

/** GET an untrusted URL with DNS pinning and per-hop validation.
 * Proxy-side DNS cannot be pinned by this process, so reject rather than bypass
 * a configured proxy or claim a DNS-preflight check makes that route safe.
 */
async function publicGet(name, rawUrl, options = {}) {
  if (options.responseType === 'stream')
    throw new Error('publicGet requires a bounded buffered response');
  const net = config.network || {};
  if (net.httpProxy || net.httpsProxy || net.socksProxy) {
    throw Object.assign(
      new Error(
        'Public-URL fetch requires a DNS-pinning-capable egress policy; configured proxy denied',
      ),
      { code: 'EUNSAFE_PROXY' },
    );
  }
  const { resolvePublicUrl } = require('./netGuard');
  const redirects = Math.min(5, Math.max(0, Number(options.maxRedirects) || 0));
  const headers = { ...options.headers };
  for (const key of Object.keys(headers)) {
    if (/^(authorization|proxy-authorization|cookie|host)$/i.test(key)) delete headers[key];
  }
  let nextUrl = rawUrl;
  for (let hop = 0; ; hop++) {
    const target = await resolvePublicUrl(nextUrl);
    const httpAgent = new http.Agent({ lookup: target.lookup, keepAlive: false });
    const httpsAgent = new https.Agent({
      lookup: target.lookup,
      keepAlive: false,
      ca: makeCAOption(),
    });
    let response;
    try {
      response = await axiosWithBreaker(name, {
        ...options,
        method: 'GET',
        url: target.url.href,
        baseURL: undefined,
        auth: undefined,
        lookup: target.lookup,
        socketPath: undefined,
        transport: undefined,
        data: undefined,
        headers,
        httpAgent,
        httpsAgent,
        proxy: false,
        maxRedirects: 0,
        maxContentLength: options.maxContentLength ?? 4 * 1024 * 1024,
        validateStatus: (status) => status >= 200 && status < 400,
      });
    } finally {
      httpAgent.destroy();
      httpsAgent.destroy();
    }
    if (response.status < 300) return response;
    if (!response.headers.location || hop >= redirects) {
      throw Object.assign(new Error('Redirect denied'), { code: 'EREDIRECT' });
    }
    nextUrl = new URL(response.headers.location, target.url).href;
    if (target.url.protocol === 'https:' && new URL(nextUrl).protocol !== 'https:') {
      throw Object.assign(new Error('HTTPS downgrade redirect denied'), { code: 'EREDIRECT' });
    }
    // The next iteration resolves, validates, and pins the new destination.
  }
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
  publicGet,
  isOpenBreakerError,
};
