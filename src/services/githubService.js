/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * GitHub subscription service.
 *
 *   meta = { repos: [{ owner, repo, kind: 'releases' | 'advisories' | 'both' }, ...] }
 *
 *   Releases:    GET /repos/{owner}/{repo}/releases?per_page=10
 *   Advisories:  GET /repos/{owner}/{repo}/security-advisories?per_page=10
 *
 *   Auth: optional config.apis.github.token (PAT). Unauthenticated
 *   requests are limited to 60/h per IP; authenticated to 5 000/h.
 *
 *   Dedup keys (service_sent_items.item_url):
 *     - release:   https://github.com/{owner}/{repo}/releases/tag/{tag}
 *     - advisory:  https://github.com/{owner}/{repo}/security/advisories/{ghsa_id}
 */

const axios = require('axios');
const { config } = require('../lib/configLoader');
const { getStore } = require('../store/instance');
const logger = require('../core/logger').child({ mod: 'github-service' });

const SERVICE = 'github';
const CHECK_INTERVAL = config.apis?.github?.checkIntervalMin || 60;
const BASE = 'https://api.github.com';

function ghHeaders() {
  const headers = {
    'Accept':               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent':           'EchoFox/0.4 (subscription)',
  };
  const token = config.apis?.github?.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchReleases(owner, repo) {
  try {
    const { data } = await axios.get(
      `${BASE}/repos/${owner}/${repo}/releases`,
      { headers: ghHeaders(), params: { per_page: 10 }, timeout: 15000 },
    );
    return (data || []).map((r) => ({
      tag:     r.tag_name,
      name:    r.name || r.tag_name,
      url:     r.html_url,
      body:    (r.body || '').trim().slice(0, 600),
      published_at: r.published_at,
      prerelease:   !!r.prerelease,
    }));
  } catch (err) {
    logger.warn({ err: err.message, owner, repo }, 'fetchReleases failed');
    return [];
  }
}

async function fetchAdvisories(owner, repo) {
  try {
    const { data } = await axios.get(
      `${BASE}/repos/${owner}/${repo}/security-advisories`,
      { headers: ghHeaders(), params: { per_page: 10 }, timeout: 15000 },
    );
    return (data || []).map((a) => ({
      ghsa_id:  a.ghsa_id,
      cve_id:   a.cve_id,
      summary:  a.summary,
      severity: a.severity,                         // low | medium | high | critical
      url:      a.html_url,
      published_at: a.published_at,
    }));
  } catch (err) {
    // 404 here usually means "no advisories" or "private repo" — not worth warn
    if (err.response?.status !== 404) {
      logger.warn({ err: err.message, owner, repo }, 'fetchAdvisories failed');
    }
    return [];
  }
}

function formatRelease(owner, repo, r) {
  const prefix = r.prerelease ? '🟡 *Pre-release*' : '🚀 *Release*';
  return [
    `${prefix} — ${owner}/${repo}`,
    `*${r.name}* (\`${r.tag}\`)`,
    r.body ? `\n${r.body}${r.body.length === 600 ? '…' : ''}` : '',
    `\n${r.url}`,
  ].filter(Boolean).join('\n');
}

function formatAdvisory(owner, repo, a) {
  const sev = (a.severity || 'unknown').toUpperCase();
  const sevEmoji = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢' }[sev] || '⚪';
  return [
    `${sevEmoji} *Security Advisory* — ${owner}/${repo}`,
    `*${a.ghsa_id}*${a.cve_id ? ` / ${a.cve_id}` : ''} · Severity: *${sev}*`,
    `\n${a.summary}`,
    `\n${a.url}`,
  ].join('\n');
}

async function checkAndDeliver(sock) {
  try {
    if (!sock) return;
    const store = getStore();
    const subscribers = await store.getSubscribers(SERVICE);
    if (!subscribers.length) return;

    for (const { jid, meta } of subscribers) {
      const repos = (meta && Array.isArray(meta.repos)) ? meta.repos : [];
      for (const target of repos) {
        if (!target?.owner || !target?.repo) continue;
        const { owner, repo, kind = 'both' } = target;

        if (kind === 'releases' || kind === 'both') {
          for (const r of await fetchReleases(owner, repo)) {
            if (await store.hasSentItem(SERVICE, jid, r.url)) continue;
            try { await sock.sendMessage(jid, { text: formatRelease(owner, repo, r) }); }
            catch (err) { logger.warn({ jid, err: err.message }, 'send release failed'); continue; }
            await store.recordSentItem(SERVICE, jid, r.url);
          }
        }
        if (kind === 'advisories' || kind === 'both') {
          for (const a of await fetchAdvisories(owner, repo)) {
            if (await store.hasSentItem(SERVICE, jid, a.url)) continue;
            try { await sock.sendMessage(jid, { text: formatAdvisory(owner, repo, a) }); }
            catch (err) { logger.warn({ jid, err: err.message }, 'send advisory failed'); continue; }
            await store.recordSentItem(SERVICE, jid, a.url);
          }
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'github checkAndDeliver failed');
  }
}

module.exports = { checkAndDeliver, CHECK_INTERVAL, fetchReleases, fetchAdvisories, formatRelease, formatAdvisory, SERVICE };