/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * VirusTotal "watch" subscription.
 *
 *   meta = {
 *     targets: [{ type: 'hash'|'ip'|'domain'|'url', id: <string>, lastMalCount?: <int> }, ...],
 *   }
 *
 *   Each cron cycle: for each target, look up its VT v3 stats and
 *   compare malicious-engine count vs last-seen count stored in meta.
 *   If it changed (in either direction), notify the subscriber and
 *   persist the new count back into meta.
 *
 *   Requires config.apis.virustotal.apiKey (same key the .virustotal
 *   command uses).
 */

const axios = require('axios');
const { config } = require('../lib/configLoader');
const { getStore } = require('../store/instance');
const logger = require('../core/logger').child({ mod: 'vtwatch-service' });

const SERVICE = 'vtwatch';
const CHECK_INTERVAL = config.apis?.vtwatch?.checkIntervalMin || 360;

// Endpoint map: target.type → VirusTotal v3 path segment
const PATH = {
  hash:   'files',
  ip:     'ip_addresses',
  domain: 'domains',
  url:    'urls',
};

function vtId(type, id) {
  // URLs need url-safe-base64 of the URL itself per VT v3 docs
  if (type !== 'url') return id;
  return Buffer.from(id).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function fetchStats(type, id) {
  const apiKey = config.apis?.virustotal?.apiKey;
  if (!apiKey) return null;
  const seg = PATH[type];
  if (!seg) return null;
  try {
    const { data } = await axios.get(
      `https://www.virustotal.com/api/v3/${seg}/${encodeURIComponent(vtId(type, id))}`,
      { headers: { 'x-apikey': apiKey }, timeout: 15000 },
    );
    const stats = data?.data?.attributes?.last_analysis_stats || {};
    return {
      malicious:  Number(stats.malicious  || 0),
      suspicious: Number(stats.suspicious || 0),
      harmless:   Number(stats.harmless   || 0),
      undetected: Number(stats.undetected || 0),
    };
  } catch (err) {
    if (err.response?.status !== 404) {
      logger.warn({ err: err.message, type, id }, 'fetchStats failed');
    }
    return null;
  }
}

function formatAlert(type, id, before, after) {
  const before_mal = before?.malicious ?? 0;
  const after_mal  = after.malicious;
  const direction  = after_mal > before_mal ? '⬆️ *Detections increased*'
                   : after_mal < before_mal ? '⬇️ Detections decreased'
                   : '➡️ Detection count stable';
  return [
    `🛡️ *VT-watch alert*`,
    `Target: \`${type}:${id}\``,
    direction,
    `Malicious: ${before_mal} → *${after_mal}*`,
    `Suspicious: ${after.suspicious} · Harmless: ${after.harmless} · Undetected: ${after.undetected}`,
    '',
    `🔗 https://www.virustotal.com/gui/${type === 'ip' ? 'ip-address' : type}/${encodeURIComponent(id)}`,
  ].join('\n');
}

async function checkAndDeliver(sock) {
  try {
    if (!sock) return;
    const store = getStore();
    const subscribers = await store.getSubscribers(SERVICE);
    if (!subscribers.length) return;
    if (!config.apis?.virustotal?.apiKey) {
      logger.warn('vtwatch: virustotal apiKey not configured; skipping cycle');
      return;
    }

    for (const { jid, meta } of subscribers) {
      const targets = (meta && Array.isArray(meta.targets)) ? meta.targets : [];
      let mutated = false;
      for (const t of targets) {
        if (!t?.type || !t?.id) continue;
        const stats = await fetchStats(t.type, t.id);
        if (!stats) continue;
        const before = (t.lastMalCount == null) ? null : { malicious: t.lastMalCount };
        // First check: just record baseline (no alert)
        if (before == null) {
          t.lastMalCount = stats.malicious;
          mutated = true;
          continue;
        }
        if (stats.malicious !== t.lastMalCount) {
          try { await sock.sendMessage(jid, { text: formatAlert(t.type, t.id, before, stats) }); }
          catch (err) { logger.warn({ jid, err: err.message }, 'vt alert send failed'); }
          t.lastMalCount = stats.malicious;
          mutated = true;
        }
      }
      if (mutated) {
        await store.updateSubscriberMeta(SERVICE, jid, { ...meta, targets });
      }
    }
  } catch (err) {
    logger.error({ err }, 'vtwatch checkAndDeliver failed');
  }
}

module.exports = { checkAndDeliver, CHECK_INTERVAL, fetchStats, formatAlert, SERVICE };