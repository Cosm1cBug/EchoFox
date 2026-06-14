/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .vtwatch — monitor VirusTotal verdict changes
 *
 *   .vtwatch add <type:id>      (hash | ip | domain | url)
 *     e.g. .vtwatch add hash:44d88612fea8a8f36de82e1278abb02f
 *          .vtwatch add ip:1.2.3.4
 *          .vtwatch add domain:example.com
 *          .vtwatch add url:https://example.com/foo
 *   .vtwatch remove <type:id>
 *   .vtwatch list / -status
 *   .vtwatch help
 *
 *   Each cron cycle (default 6h) fetches stats for each target via
 *   VT v3 and notifies you ONLY when the malicious-engine count
 *   changes vs the previously-stored value.
 *
 *   Requires config.apis.virustotal.apiKey.
 */

const { getStore } = require('../../store/instance');
const { config } = require('../../lib/configLoader');
const logger = require('../../core/logger').child({ mod: 'vtwatch-cmd' });

const SERVICE = 'vtwatch';
const TYPE_RE = /^(hash|ip|domain|url):(.+)$/i;
const VERBS_STATUS = new Set(['status', '-status', '--status', 'list']);
const VERBS_HELP = new Set(['help', '-help', '--help', '?', '']);

function parseTarget(rest) {
  const tok = rest.split(/\s+/)[0] || '';
  const m = TYPE_RE.exec(tok);
  if (!m) return null;
  return { type: m[1].toLowerCase(), id: m[2] };
}

function helpPanel() {
  return [
    '🛡️ *VirusTotal Watch*',
    '',
    'Track verdict changes on IPs, domains, URLs, or file hashes.',
    `Polls every ${config.apis?.vtwatch?.checkIntervalMin || 360} minutes; alerts only when malicious-engine count changes.`,
    '',
    '*Commands*',
    '• `.vtwatch add hash:<sha256>`        — watch a file hash',
    '• `.vtwatch add ip:<address>`          — watch an IP',
    '• `.vtwatch add domain:<name>`         — watch a domain',
    '• `.vtwatch add url:<full-url>`        — watch a URL',
    '• `.vtwatch remove <type:id>`          — stop watching',
    '• `.vtwatch list`                      — show your targets',
    '• `.vtwatch -status`                   — alias for list',
    '• `.vtwatch help`                      — show this message',
    '',
    config.apis?.virustotal?.apiKey
      ? '_VT API key configured._'
      : '⚠️ _config.apis.virustotal.apiKey is empty — alerts will be skipped._',
  ].join('\n');
}

module.exports = {
  name: 'vtwatch',
  alias: ['vt-watch', 'vtw'],
  usage: `<add/remove/list> <type:id>`,
  type: 'general',
  info: 'Watch VirusTotal verdict changes on hashes/IPs/domains/URLs.',
  start: async (sock, m, { text }) => {
    if (!m.isPrivate) {
      return await sock.sendMessage(
        m.chat,
        { text: '❌ Can only be used in Private Chats.' },
        { quoted: m },
      );
    }

    const jid = String(m.sender || m.from);
    const store = getStore();
    const raw = String(text || '').trim();
    const firstSpace = raw.indexOf(' ');
    const verb = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toLowerCase();
    const rest = firstSpace === -1 ? '' : raw.slice(firstSpace + 1).trim();

    if (verb === 'add') {
      const target = parseTarget(rest);
      if (!target) {
        return await sock.sendMessage(
          m.chat,
          { text: 'Usage: `.vtwatch add <hash|ip|domain|url>:<value>`' },
          { quoted: m },
        );
      }
      const existingMeta = (await store.getSubscriberMeta(SERVICE, jid)) || {};
      const targets = Array.isArray(existingMeta.targets) ? [...existingMeta.targets] : [];
      const dup = targets.find((t) => t.type === target.type && t.id === target.id);
      if (dup) {
        return await sock.sendMessage(
          m.chat,
          { text: `☑️ Already watching \`${target.type}:${target.id}\`.` },
          { quoted: m },
        );
      }
      targets.push({ type: target.type, id: target.id, lastMalCount: null });
      const meta = { ...existingMeta, targets };
      const isSub = await store.isSubscriber(SERVICE, jid);
      if (isSub) await store.updateSubscriberMeta(SERVICE, jid, meta);
      else await store.addSubscriber(SERVICE, jid, meta);
      logger.info({ jid, action: 'add-target', target }, 'vtwatch target added');
      return await sock.sendMessage(
        m.chat,
        {
          text: `✅ Watching \`${target.type}:${target.id}\`.\n_You'll be alerted when malicious-engine count changes._`,
        },
        { quoted: m },
      );
    }

    if (verb === 'remove' || verb === 'rm') {
      const target = parseTarget(rest);
      if (!target) {
        return await sock.sendMessage(
          m.chat,
          { text: 'Usage: `.vtwatch remove <type:id>`' },
          { quoted: m },
        );
      }
      const meta = (await store.getSubscriberMeta(SERVICE, jid)) || {};
      const targets = Array.isArray(meta.targets)
        ? meta.targets.filter((t) => !(t.type === target.type && t.id === target.id))
        : [];
      if (!targets.length) {
        await store.removeSubscriber(SERVICE, jid);
        return await sock.sendMessage(
          m.chat,
          { text: `❌ Removed last target; you are no longer subscribed to .vtwatch.` },
          { quoted: m },
        );
      }
      await store.updateSubscriberMeta(SERVICE, jid, { ...meta, targets });
      logger.info({ jid, action: 'remove-target', target }, 'vtwatch target removed');
      return await sock.sendMessage(
        m.chat,
        { text: `❌ Removed \`${target.type}:${target.id}\`. (${targets.length} remaining.)` },
        { quoted: m },
      );
    }

    if (VERBS_STATUS.has(verb)) {
      const isSub = await store.isSubscriber(SERVICE, jid);
      if (!isSub) {
        return await sock.sendMessage(
          m.chat,
          { text: '📭 *VT-watch*\n\nYou have no targets. Use `.vtwatch add <type:id>` to start.' },
          { quoted: m },
        );
      }
      const meta = (await store.getSubscriberMeta(SERVICE, jid)) || {};
      const targets = Array.isArray(meta.targets) ? meta.targets : [];
      if (!targets.length) {
        return await sock.sendMessage(
          m.chat,
          { text: '📭 *VT-watch*\n\nYou have no targets.' },
          { quoted: m },
        );
      }
      const lines = targets.map((t, i) => {
        const seen = t.lastMalCount == null ? '_(not yet checked)_' : `mal=*${t.lastMalCount}*`;
        return `${i + 1}. \`${t.type}:${t.id}\` — ${seen}`;
      });
      return await sock.sendMessage(
        m.chat,
        {
          text: [`📬 *VT-watch targets* (${targets.length})`, '', ...lines].join('\n'),
        },
        { quoted: m },
      );
    }

    if (VERBS_HELP.has(verb)) {
      return await sock.sendMessage(m.chat, { text: helpPanel() }, { quoted: m });
    }

    return await sock.sendMessage(
      m.chat,
      { text: `Unknown verb *${verb}*. Use \`.vtwatch help\` to see options.` },
      { quoted: m },
    );
  },
};
