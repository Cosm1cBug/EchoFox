/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * AI tool registry — 12 tools, "intel-focused" scope (v1.2.0).
 *
 * Read-only store queries (5):
 *   get_blocklist
 *   get_presence_in_chat
 *   get_labels_for_chat
 *   list_newsletters
 *   get_recent_messages
 *
 * Intel commands (7):
 *   check_virustotal       — needs config.apis.virustotal.apiKey
 *   search_alienvault      — needs config.apis.alienvault.apiKey
 *   latest_hackernews
 *   github_releases
 *   github_advisories
 *   wiki_lookup
 *   fetch_url              — SSRF-guarded GET, max 200 KB
 *
 * Each tool is described in provider-neutral JSON-Schema. Per-provider
 * adapters (providers/openai.js, gemini.js, anthropic.js) translate
 * the spec into the exact shape that provider expects.
 *
 *   getActiveSpec()                 -> array of definitions enabled by
 *                                      config.ai.toolWhitelist + key presence
 *   invoke(name, args)              -> Promise<{ ok: boolean, result?, error? }>
 */
const logger = require('../../core/logger').child({ mod: 'ai/tools' });
const { config } = require('../../lib/configLoader');
const { getStore } = require('../../store/instance');
const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

// ─── tool definitions ─────────────────────────────────────────────
const DEFS = {
  get_blocklist: {
    description: 'Return the current WhatsApp blocklist for this bot.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    requiresKey: null,
    handler: async () => {
      const store = getStore();
      const rows = (store && await store.getBlocklist?.()) || [];
      return { count: rows.length, sample: rows.slice(0, 20) };
    },
  },

  get_presence_in_chat: {
    description: 'Return the most recent presence states observed in a given chat.',
    parameters: {
      type: 'object',
      properties: {
        chat_jid: { type: 'string', description: 'WhatsApp chat JID (e.g. "1234@s.whatsapp.net" or "1234-5678@g.us")' },
        limit:    { type: 'integer', default: 20, minimum: 1, maximum: 200 },
      },
      required: ['chat_jid'],
      additionalProperties: false,
    },
    requiresKey: null,
    handler: async ({ chat_jid, limit = 20 }) => {
      const store = getStore();
      if (!store?.getPresenceInChat) return { unavailable: true };
      return { presence: await store.getPresenceInChat(chat_jid, Number(limit)) };
    },
  },

  get_labels_for_chat: {
    description: 'Return WhatsApp Business labels attached to a given chat or message target.',
    parameters: {
      type: 'object',
      properties: { target_jid: { type: 'string' } },
      required: ['target_jid'],
      additionalProperties: false,
    },
    requiresKey: null,
    handler: async ({ target_jid }) => {
      const store = getStore();
      if (!store?.getLabelsForTarget) return { unavailable: true };
      return { labels: await store.getLabelsForTarget(target_jid) };
    },
  },

  list_newsletters: {
    description: 'List the WhatsApp newsletters (channels) the bot is currently aware of.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    requiresKey: null,
    handler: async () => {
      const store = getStore();
      if (!store?.listNewsletters) return { unavailable: true };
      const rows = await store.listNewsletters();
      return { count: rows.length, newsletters: rows.slice(0, 50) };
    },
  },

  get_recent_messages: {
    description: 'Return the most recent N stored messages from a chat (subject to privacy.storeMessageBodies).',
    parameters: {
      type: 'object',
      properties: {
        chat_jid: { type: 'string' },
        limit:    { type: 'integer', default: 20, minimum: 1, maximum: 200 },
      },
      required: ['chat_jid'],
      additionalProperties: false,
    },
    requiresKey: null,
    handler: async ({ chat_jid, limit = 20 }) => {
      const store = getStore();
      if (!store?.getRecentMessages) return { unavailable: true };
      return { messages: await store.getRecentMessages(chat_jid, Number(limit)) };
    },
  },

  // ─── intel APIs ────────────────────────────────────────────────
  check_virustotal: {
    description: 'Look up a hash / URL / IP / domain on VirusTotal. Returns vendor verdict counts.',
    parameters: {
      type: 'object',
      properties: {
        ioc:  { type: 'string', description: 'hash (md5/sha1/sha256), URL, IP or domain' },
        kind: { type: 'string', enum: ['auto', 'file', 'url', 'ip', 'domain'], default: 'auto' },
      },
      required: ['ioc'],
      additionalProperties: false,
    },
    requiresKey: () => config.apis?.virustotal?.apiKey,
    handler: async ({ ioc, kind = 'auto' }) => {
      const key = config.apis?.virustotal?.apiKey;
      if (!key) return { error: 'no_api_key' };
      const k = kind === 'auto' ? _detectIoc(ioc) : kind;
      const map = { file: 'files', url: 'urls', ip: 'ip_addresses', domain: 'domains' };
      const slug = map[k] || 'files';
      const ident = k === 'url' ? Buffer.from(String(ioc)).toString('base64url') : ioc;
      const ax = axiosWithBreaker('vt-tool', { timeout: 10_000 });
      try {
        const r = await ax.get(`https://www.virustotal.com/api/v3/${slug}/${encodeURIComponent(ident)}`, {
          headers: { 'x-apikey': key },
        });
        const stats = r.data?.data?.attributes?.last_analysis_stats || {};
        return { kind: k, stats, reputation: r.data?.data?.attributes?.reputation };
      } catch (e) {
        if (isOpenBreakerError(e)) return { error: 'circuit_open' };
        return { error: e.response?.status ? `http_${e.response.status}` : (e.code || e.message) };
      }
    },
  },

  search_alienvault: {
    description: 'Search AlienVault OTX for an IoC (hash, URL, IP, domain). Returns pulse summary.',
    parameters: {
      type: 'object',
      properties: { ioc: { type: 'string' } },
      required: ['ioc'],
      additionalProperties: false,
    },
    requiresKey: () => config.apis?.alienvault?.apiKey,
    handler: async ({ ioc }) => {
      const key = config.apis?.alienvault?.apiKey;
      if (!key) return { error: 'no_api_key' };
      const kind = _detectIoc(ioc);
      const kindMap = { file: 'file', url: 'url', ip: 'IPv4', domain: 'domain' };
      const ax = axiosWithBreaker('otx-tool', { timeout: 10_000 });
      try {
        const r = await ax.get(`https://otx.alienvault.com/api/v1/indicators/${kindMap[kind] || 'file'}/${encodeURIComponent(ioc)}/general`, {
          headers: { 'X-OTX-API-KEY': key },
        });
        const pulses = r.data?.pulse_info?.pulses || [];
        return {
          kind,
          pulse_count: pulses.length,
          top_pulses: pulses.slice(0, 5).map((p) => ({ name: p.name, tlp: p.tlp, tags: (p.tags || []).slice(0, 5) })),
        };
      } catch (e) {
        if (isOpenBreakerError(e)) return { error: 'circuit_open' };
        return { error: e.response?.status ? `http_${e.response.status}` : (e.code || e.message) };
      }
    },
  },

  latest_hackernews: {
    description: 'Return the latest articles from The Hacker News RSS feed.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', default: 5, minimum: 1, maximum: 20 } },
      additionalProperties: false,
    },
    requiresKey: null,
    handler: async ({ limit = 5 }) => {
      const ax = axiosWithBreaker('thn-tool', { timeout: 10_000 });
      try {
        const r = await ax.get('https://feeds.feedburner.com/TheHackersNews', {
          headers: { 'User-Agent': config.network?.userAgent || 'EchoFox/1.2 (+intel)' },
          responseType: 'text',
        });
        const items = _quickRssItems(r.data, Number(limit));
        return { count: items.length, items };
      } catch (e) {
        if (isOpenBreakerError(e)) return { error: 'circuit_open' };
        return { error: e.code || e.message };
      }
    },
  },

  github_releases: {
    description: 'Return the latest GitHub releases for a repo (e.g. "openai/openai-node").',
    parameters: {
      type: 'object',
      properties: {
        repo:  { type: 'string', description: 'owner/repo' },
        limit: { type: 'integer', default: 5, minimum: 1, maximum: 30 },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    requiresKey: null,
    handler: async ({ repo, limit = 5 }) => {
      const ax = axiosWithBreaker('gh-rel-tool', { timeout: 10_000 });
      const headers = { Accept: 'application/vnd.github+json' };
      if (config.apis?.github?.token) headers.Authorization = `Bearer ${config.apis.github.token}`;
      try {
        const r = await ax.get(`https://api.github.com/repos/${encodeURIComponent(repo).replace('%2F', '/')}/releases?per_page=${Number(limit)}`, { headers });
        return {
          repo,
          releases: (r.data || []).map((x) => ({ name: x.name, tag: x.tag_name, published: x.published_at, url: x.html_url })),
        };
      } catch (e) {
        if (isOpenBreakerError(e)) return { error: 'circuit_open' };
        return { error: e.response?.status ? `http_${e.response.status}` : (e.code || e.message) };
      }
    },
  },

  github_advisories: {
    description: 'Search the GitHub Security Advisory database (e.g. for "log4j" or "CVE-2025-1234").',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', default: 5, minimum: 1, maximum: 20 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    requiresKey: null,
    handler: async ({ query, limit = 5 }) => {
      const ax = axiosWithBreaker('gh-adv-tool', { timeout: 10_000 });
      const headers = { Accept: 'application/vnd.github+json' };
      if (config.apis?.github?.token) headers.Authorization = `Bearer ${config.apis.github.token}`;
      try {
        const url = `https://api.github.com/advisories?per_page=${Number(limit)}&type=reviewed&sort=published&direction=desc&query=${encodeURIComponent(query)}`;
        const r = await ax.get(url, { headers });
        return {
          query,
          advisories: (r.data || []).map((a) => ({
            cve: a.cve_id, ghsa: a.ghsa_id, severity: a.severity,
            summary: a.summary, published: a.published_at, url: a.html_url,
          })),
        };
      } catch (e) {
        if (isOpenBreakerError(e)) return { error: 'circuit_open' };
        return { error: e.response?.status ? `http_${e.response.status}` : (e.code || e.message) };
      }
    },
  },

  wiki_lookup: {
    description: 'Quick Wikipedia summary lookup (en).',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    requiresKey: null,
    handler: async ({ query }) => {
      const ax = axiosWithBreaker('wiki-tool', { timeout: 8_000 });
      try {
        const r = await ax.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`, {
          headers: { 'User-Agent': config.network?.userAgent || 'EchoFox/1.2 (+intel)' },
        });
        return {
          title:     r.data?.title,
          extract:   (r.data?.extract || '').slice(0, 1500),
          url:       r.data?.content_urls?.desktop?.page,
          disambig:  r.data?.type === 'disambiguation',
        };
      } catch (e) {
        if (isOpenBreakerError(e)) return { error: 'circuit_open' };
        return { error: e.response?.status ? `http_${e.response.status}` : (e.code || e.message) };
      }
    },
  },

  fetch_url: {
    description: 'GET a public URL and return up to 200 KB of text. SSRF-guarded — refuses localhost / RFC 1918 / link-local.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'http(s) URL' } },
      required: ['url'],
      additionalProperties: false,
    },
    requiresKey: null,
    handler: async ({ url }) => {
      let u;
      try { u = new URL(url); }
      catch { return { error: 'bad_url' }; }
      if (!/^https?:$/.test(u.protocol)) return { error: 'bad_scheme' };
      if (_isPrivateHost(u.hostname))     return { error: 'private_host_blocked' };

      const ax = axiosWithBreaker('fetch-url-tool', { timeout: 10_000, maxContentLength: 200_000 });
      try {
        const r = await ax.get(u.toString(), {
          headers: { 'User-Agent': config.network?.userAgent || 'EchoFox/1.2 (+intel)' },
          responseType: 'text',
          maxRedirects: 3,
        });
        const body = typeof r.data === 'string' ? r.data.slice(0, 200_000) : JSON.stringify(r.data).slice(0, 200_000);
        return { status: r.status, content_type: r.headers?.['content-type'], body };
      } catch (e) {
        if (isOpenBreakerError(e)) return { error: 'circuit_open' };
        return { error: e.response?.status ? `http_${e.response.status}` : (e.code || e.message) };
      }
    },
  },
};

// ─── helpers ─────────────────────────────────────────────────────
function _detectIoc(s) {
  const v = String(s || '').trim();
  if (/^[a-fA-F0-9]{32,64}$/.test(v))                            return 'file';
  if (/^https?:\/\//i.test(v))                                   return 'url';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v))                         return 'ip';
  return 'domain';
}

function _isPrivateHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (h === '0.0.0.0' || h === '::1') return true;
  return false;
}

// Very-small RSS shim — enough for THN.
function _quickRssItems(xml, limit) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m; let i = 0;
  while ((m = re.exec(xml)) && i < limit) {
    const block = m[1];
    const grab = (tag) => {
      const r = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(block);
      return r ? r[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };
    out.push({ title: grab('title'), link: grab('link'), pubDate: grab('pubDate') });
    i += 1;
  }
  return out;
}

// ─── public API ───────────────────────────────────────────────────

function getActiveSpec() {
  const allowed = new Set(config.ai?.toolWhitelist || []);
  const out = [];
  for (const [name, def] of Object.entries(DEFS)) {
    if (!allowed.has(name)) continue;
    if (typeof def.requiresKey === 'function' && !def.requiresKey()) continue;
    out.push({
      name,
      description: def.description,
      parameters:  def.parameters,
    });
  }
  return out;
}

async function invoke(name, args) {
  const def = DEFS[name];
  if (!def) return { ok: false, error: 'unknown_tool' };
  try {
    const result = await def.handler(args || {});
    return { ok: true, result };
  } catch (e) {
    logger.warn({ err: e, name }, 'tool invocation failed');
    return { ok: false, error: e.message || String(e) };
  }
}

module.exports = { DEFS, getActiveSpec, invoke, _isPrivateHost, _detectIoc };
