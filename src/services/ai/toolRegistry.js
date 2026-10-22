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
 *   getActiveSpec(context)          -> array of definitions enabled by
 *                                      config.ai.toolWhitelist + key presence
 *   invoke(name, args, context)     -> Promise<{ ok: boolean, result?, error? }>
 */
const logger = require('../../core/logger').child({ mod: 'ai/tools' });
const { config } = require('../../lib/configLoader');
const { getStore } = require('../../store/instance');
const { axiosWithBreaker, publicGet, isOpenBreakerError } = require('../../lib/network');
const { isPrivateHost } = require('../../lib/netGuard');
const { isExcluded, canStoreMessageBodies } = require('../../lib/privacyPolicy');
const { z } = require('zod');

function get(name, url, options = {}) {
  return axiosWithBreaker(name, { timeout: 10_000, ...options, method: 'GET', url });
}
function requestError(error) {
  if (isOpenBreakerError(error)) return 'circuit_open';
  if (Number.isInteger(error.response?.status)) return `http_${error.response.status}`;
  if (error.code === 'EPRIVATE') return 'private_host_blocked';
  if (
    ['EDNS', 'EBADURL', 'EBADSCHEME', 'EBADCREDENTIALS', 'EREDIRECT', 'EUNSAFE_PROXY'].includes(
      error.code,
    )
  )
    return error.code;
  return 'request_failed';
}

// ─── tool definitions ─────────────────────────────────────────────
const DEFS = {
  get_blocklist: {
    description: 'Return the current WhatsApp blocklist for this bot.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    requiresKey: null,
    handler: async () => {
      const store = getStore();
      const rows = (store && (await store.getBlocklist?.())) || [];
      return { count: rows.length, sample: rows.slice(0, 20) };
    },
  },

  get_presence_in_chat: {
    description: 'Return the most recent presence states observed in a given chat.',
    parameters: {
      type: 'object',
      properties: {
        chat_jid: {
          type: 'string',
          description: 'WhatsApp chat JID (e.g. "1234@s.whatsapp.net" or "1234-5678@g.us")',
        },
        limit: { type: 'integer', default: 20, minimum: 1, maximum: 200 },
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
    description:
      'Return the most recent N stored messages from a chat (subject to privacy.storeMessageBodies).',
    parameters: {
      type: 'object',
      properties: {
        chat_jid: { type: 'string' },
        limit: { type: 'integer', default: 20, minimum: 1, maximum: 200 },
      },
      required: ['chat_jid'],
      additionalProperties: false,
    },
    requiresKey: null,
    handler: async ({ chat_jid, limit = 20 }) => {
      const store = getStore();
      if (typeof store?.getRecentMessages === 'function')
        return { messages: await store.getRecentMessages(chat_jid, Number(limit)) };
      if (typeof store?.listMessages === 'function')
        return { messages: await store.listMessages(chat_jid, { limit: Number(limit) }) };
      return { unavailable: true };
    },
  },

  // ─── intel APIs ────────────────────────────────────────────────
  check_virustotal: {
    description: 'Look up a hash / URL / IP / domain on VirusTotal. Returns vendor verdict counts.',
    parameters: {
      type: 'object',
      properties: {
        ioc: { type: 'string', description: 'hash (md5/sha1/sha256), URL, IP or domain' },
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
      try {
        const r = await get(
          'vt-tool',
          `https://www.virustotal.com/api/v3/${slug}/${encodeURIComponent(ident)}`,
          {
            headers: { 'x-apikey': key },
          },
        );
        const stats = r.data?.data?.attributes?.last_analysis_stats || {};
        return { kind: k, stats, reputation: r.data?.data?.attributes?.reputation };
      } catch (e) {
        return { error: requestError(e) };
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
      try {
        const r = await get(
          'otx-tool',
          `https://otx.alienvault.com/api/v1/indicators/${kindMap[kind] || 'file'}/${encodeURIComponent(ioc)}/general`,
          {
            headers: { 'X-OTX-API-KEY': key },
          },
        );
        const pulses = r.data?.pulse_info?.pulses || [];
        return {
          kind,
          pulse_count: pulses.length,
          top_pulses: pulses
            .slice(0, 5)
            .map((p) => ({ name: p.name, tlp: p.tlp, tags: (p.tags || []).slice(0, 5) })),
        };
      } catch (e) {
        return { error: requestError(e) };
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
      try {
        const r = await get('thn-tool', 'https://feeds.feedburner.com/TheHackersNews', {
          headers: { 'User-Agent': config.network?.userAgent || 'EchoFox/1.2 (+intel)' },
          responseType: 'text',
        });
        const items = _quickRssItems(r.data, Number(limit));
        return { count: items.length, items };
      } catch (e) {
        return { error: requestError(e) };
      }
    },
  },

  github_releases: {
    description: 'Return the latest GitHub releases for a repo (e.g. "openai/openai-node").',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/repo' },
        limit: { type: 'integer', default: 5, minimum: 1, maximum: 30 },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    requiresKey: null,
    handler: async ({ repo, limit = 5 }) => {
      const headers = { Accept: 'application/vnd.github+json' };
      if (config.apis?.github?.token) headers.Authorization = `Bearer ${config.apis.github.token}`;
      try {
        const r = await get(
          'gh-rel-tool',
          `https://api.github.com/repos/${encodeURIComponent(repo).replace('%2F', '/')}/releases?per_page=${Number(limit)}`,
          { headers },
        );
        return {
          repo,
          releases: (r.data || []).map((x) => ({
            name: x.name,
            tag: x.tag_name,
            published: x.published_at,
            url: x.html_url,
          })),
        };
      } catch (e) {
        return { error: requestError(e) };
      }
    },
  },

  github_advisories: {
    description:
      'Search the GitHub Security Advisory database (e.g. for "log4j" or "CVE-2025-1234").',
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
      const headers = { Accept: 'application/vnd.github+json' };
      if (config.apis?.github?.token) headers.Authorization = `Bearer ${config.apis.github.token}`;
      try {
        const url = `https://api.github.com/advisories?per_page=${Number(limit)}&type=reviewed&sort=published&direction=desc&query=${encodeURIComponent(query)}`;
        const r = await get('gh-adv-tool', url, { headers });
        return {
          query,
          advisories: (r.data || []).map((a) => ({
            cve: a.cve_id,
            ghsa: a.ghsa_id,
            severity: a.severity,
            summary: a.summary,
            published: a.published_at,
            url: a.html_url,
          })),
        };
      } catch (e) {
        return { error: requestError(e) };
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
      try {
        const r = await get(
          'wiki-tool',
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
          {
            headers: { 'User-Agent': config.network?.userAgent || 'EchoFox/1.2 (+intel)' },
          },
        );
        return {
          title: r.data?.title,
          extract: (r.data?.extract || '').slice(0, 1500),
          url: r.data?.content_urls?.desktop?.page,
          disambig: r.data?.type === 'disambiguation',
        };
      } catch (e) {
        return { error: requestError(e) };
      }
    },
  },

  fetch_url: {
    description:
      'GET a public URL and return up to 200 KB of text. SSRF-guarded — refuses localhost / RFC 1918 / link-local.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'http(s) URL' } },
      required: ['url'],
      additionalProperties: false,
    },
    requiresKey: null,
    handler: async ({ url }) => {
      try {
        const r = await publicGet('fetch-url-tool', url, {
          timeout: 10_000,
          maxContentLength: 200_000,
          maxBodyLength: 200_000,
          responseType: 'text',
          maxRedirects: 0,
        });
        const body = (typeof r.data === 'string' ? r.data : JSON.stringify(r.data)).slice(
          0,
          200_000,
        );
        return { status: r.status, content_type: r.headers?.['content-type'], body };
      } catch (e) {
        return { error: requestError(e) };
      }
    },
  },
};

// ─── helpers ─────────────────────────────────────────────────────
function _detectIoc(s) {
  const v = String(s || '').trim();
  if (/^[a-fA-F0-9]{32,64}$/.test(v)) return 'file';
  if (/^https?:\/\//i.test(v)) return 'url';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return 'ip';
  return 'domain';
}

// Very-small RSS shim — enough for THN.
function _quickRssItems(xml, limit) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  let i = 0;
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

const JID = /^(?:\d+(?:-\d+)?@g\.us|\d+@(?:s\.whatsapp\.net|lid))$/;
const GLOBAL_TOOLS = new Set(['get_blocklist', 'list_newsletters']);
const CHAT_ARGUMENTS = {
  get_presence_in_chat: 'chat_jid',
  get_labels_for_chat: 'target_jid',
  get_recent_messages: 'chat_jid',
};

function accessError(name, context) {
  if (!config.ai?.enabled || !config.ai?.enableToolCalling) return 'tools_disabled';
  if (!(config.ai.toolWhitelist || []).includes(name)) return 'tool_not_allowed';
  if (!context || !JID.test(context.chatJid) || !JID.test(context.userJid))
    return 'missing_caller_context';
  if (isExcluded(context.chatJid)) return 'chat_excluded';
  if (GLOBAL_TOOLS.has(name) && context.isAdmin !== true) return 'admin_required';
  if (name === 'get_recent_messages' && !canStoreMessageBodies(context.chatJid))
    return 'message_bodies_disabled';
  const def = DEFS[name];
  if (typeof def.requiresKey === 'function' && !def.requiresKey()) return 'missing_api_key';
  return null;
}

function argumentSchema(parameters) {
  const fields = {};
  for (const [key, field] of Object.entries(parameters.properties || {})) {
    let rule;
    if (field.type === 'integer') {
      rule = z
        .number()
        .int()
        .min(field.minimum ?? 0)
        .max(field.maximum ?? 200);
    } else {
      rule = field.enum ? z.enum(field.enum) : z.string().trim().min(1).max(4096);
    }
    if (field.default !== undefined) rule = rule.default(field.default);
    else if (!(parameters.required || []).includes(key)) rule = rule.optional();
    fields[key] = rule;
  }
  return z.object(fields).strict();
}
const ARGUMENT_SCHEMAS = Object.fromEntries(
  Object.entries(DEFS).map(([name, def]) => [name, argumentSchema(def.parameters)]),
);

/** context is derived by the server from the incoming message, NEVER tool args. */
function getActiveSpec(context) {
  return Object.entries(DEFS)
    .filter(([name]) => !accessError(name, context))
    .map(([name, def]) => ({ name, description: def.description, parameters: def.parameters }));
}

async function invoke(name, args, context) {
  if (typeof name !== 'string' || !Object.hasOwn(DEFS, name))
    return { ok: false, error: 'unknown_tool' };
  const denied = accessError(name, context);
  if (denied) return { ok: false, error: denied };
  args = args ?? {};
  if (
    typeof args !== 'object' ||
    Array.isArray(args) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(args))
  ) {
    return { ok: false, error: 'invalid_arguments' };
  }
  const parsed = ARGUMENT_SCHEMAS[name].safeParse(args);
  if (!parsed.success) return { ok: false, error: 'invalid_arguments' };
  const scopeKey = CHAT_ARGUMENTS[name];
  // Even administrators' model sessions may not jump into another chat.
  if (scopeKey && parsed.data[scopeKey] !== context.chatJid)
    return { ok: false, error: 'chat_scope_denied' };
  try {
    const result = await DEFS[name].handler(parsed.data);
    if (result?.error) return { ok: false, error: result.error };
    return { ok: true, result };
  } catch (e) {
    // Axios errors can include headers, URLs and API keys. Never serialize them.
    logger.warn({ name, code: requestError(e) }, 'tool invocation failed');
    return { ok: false, error: 'tool_failed' };
  }
}

module.exports = { DEFS, getActiveSpec, invoke, _isPrivateHost: isPrivateHost, _detectIoc };
