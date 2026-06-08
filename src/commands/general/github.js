/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .github — releases + security advisories per repo
 *
 *   .github releases <owner/repo>         subscribe to releases only
 *   .github advisories <owner/repo>       subscribe to security advisories only
 *   .github watch <owner/repo>            both (releases + advisories)
 *   .github remove <owner/repo>           unsubscribe from one repo
 *   .github list / -status                show subscribed repos
 *   .github help
 */

const { getStore } = require('../../store/instance');
const { config }   = require('../../lib/configLoader');
const logger = require('../../core/logger').child({ mod: 'github-cmd' });

const SERVICE = 'github';
const REPO_RE = /^([a-zA-Z0-9][a-zA-Z0-9._-]{0,38})\/([a-zA-Z0-9._-]{1,100})$/;
const VERBS_STATUS = new Set(['status', '-status', '--status', 'list']);
const VERBS_HELP   = new Set(['help', '-help', '--help', '?', '']);

function parseRepo(rest) {
  const target = rest.split(/\s+/)[0] || '';
  const m = REPO_RE.exec(target);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function helpPanel() {
  return [
    '🐙 *GitHub Subscription*',
    '',
    'Receive GitHub releases and/or security advisories for any public repo,',
    `polled every ${config.apis?.github?.checkIntervalMin || 60} minutes.`,
    '',
    '*Commands*',
    '• `.github releases <owner/repo>`     — subscribe to releases',
    '• `.github advisories <owner/repo>`   — subscribe to security advisories',
    '• `.github watch <owner/repo>`        — subscribe to both',
    '• `.github remove <owner/repo>`       — unsubscribe from one repo',
    '• `.github list`                       — show your subscriptions',
    '• `.github -status`                    — alias for list',
    '• `.github help`                       — show this message',
    '',
    config.apis?.github?.token
      ? '_Authenticated mode — 5 000 requests/hour rate limit._'
      : '_Anonymous mode — 60 requests/hour rate limit. Set config.apis.github.token for higher limits._',
  ].join('\n');
}

async function addOrUpdate(store, jid, owner, repo, kind) {
  const existingMeta = (await store.getSubscriberMeta(SERVICE, jid)) || {};
  const repos = Array.isArray(existingMeta.repos) ? [...existingMeta.repos] : [];
  const dupIdx = repos.findIndex((r) => r.owner === owner && r.repo === repo);
  if (dupIdx >= 0) repos[dupIdx] = { owner, repo, kind };
  else             repos.push({ owner, repo, kind });

  const meta = { ...existingMeta, repos };
  const isSub = await store.isSubscriber(SERVICE, jid);
  if (isSub) await store.updateSubscriberMeta(SERVICE, jid, meta);
  else       await store.addSubscriber(SERVICE, jid, meta);
  return dupIdx >= 0 ? 'updated' : 'added';
}

module.exports = {
  name: 'github',
  alias: ['gh'],
  usage: `<releases/advisories/watch/remove/list> <owner/repo>`,
  type: 'general',
  info: 'Subscribe to GitHub releases + security advisories.',
  start: async (sock, m, { text }) => {
    if (!m.isPrivate) {
      return await sock.sendMessage(m.chat,
        { text: '❌ Can only be used in Private Chats.' }, { quoted: m });
    }

    const jid = String(m.sender || m.from);
    const store = getStore();
    const raw = String(text || '').trim();
    const firstSpace = raw.indexOf(' ');
    const verb = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toLowerCase();
    const rest = firstSpace === -1 ? '' : raw.slice(firstSpace + 1).trim();

    const KIND = { releases: 'releases', advisories: 'advisories', watch: 'both' };
    if (KIND[verb]) {
      const target = parseRepo(rest);
      if (!target) {
        return await sock.sendMessage(m.chat,
          { text: `Usage: \`.github ${verb} <owner/repo>\` (e.g. \`.github ${verb} nodejs/node\`)` },
          { quoted: m });
      }
      const action = await addOrUpdate(store, jid, target.owner, target.repo, KIND[verb]);
      logger.info({ jid, action: 'subscribe-' + action, target, kind: KIND[verb] }, 'github subscription changed');
      const kindLabel = KIND[verb] === 'both' ? 'releases + advisories' : KIND[verb];
      return await sock.sendMessage(m.chat,
        { text: `✅ Subscribed to *${target.owner}/${target.repo}* (${kindLabel}).` },
        { quoted: m });
    }

    if (verb === 'remove' || verb === 'rm') {
      const target = parseRepo(rest);
      if (!target) {
        return await sock.sendMessage(m.chat,
          { text: 'Usage: `.github remove <owner/repo>`' }, { quoted: m });
      }
      const meta = (await store.getSubscriberMeta(SERVICE, jid)) || {};
      const repos = Array.isArray(meta.repos)
        ? meta.repos.filter((r) => !(r.owner === target.owner && r.repo === target.repo))
        : [];
      if (!repos.length) {
        await store.removeSubscriber(SERVICE, jid);
        return await sock.sendMessage(m.chat,
          { text: `❌ Removed last repo; you are no longer subscribed to .github.` },
          { quoted: m });
      }
      await store.updateSubscriberMeta(SERVICE, jid, { ...meta, repos });
      logger.info({ jid, action: 'remove-repo', target }, 'github repo removed');
      return await sock.sendMessage(m.chat,
        { text: `❌ Removed *${target.owner}/${target.repo}*. (${repos.length} remaining.)` },
        { quoted: m });
    }

    if (VERBS_STATUS.has(verb)) {
      const isSub = await store.isSubscriber(SERVICE, jid);
      if (!isSub) {
        return await sock.sendMessage(m.chat,
          { text: '📭 *GitHub subscription*\n\nYou have no repos. Use `.github watch <owner/repo>` to subscribe.' },
          { quoted: m });
      }
      const meta = (await store.getSubscriberMeta(SERVICE, jid)) || {};
      const repos = Array.isArray(meta.repos) ? meta.repos : [];
      if (!repos.length) {
        return await sock.sendMessage(m.chat,
          { text: '📭 *GitHub subscription*\n\nYou have no repos.' }, { quoted: m });
      }
      const lines = repos.map((r, i) =>
        `${i + 1}. *${r.owner}/${r.repo}* — ${r.kind === 'both' ? 'releases + advisories' : r.kind}`);
      return await sock.sendMessage(m.chat, {
        text: [`📬 *GitHub subscriptions* (${repos.length})`, '', ...lines].join('\n'),
      }, { quoted: m });
    }

    if (VERBS_HELP.has(verb)) {
      return await sock.sendMessage(m.chat, { text: helpPanel() }, { quoted: m });
    }

    return await sock.sendMessage(m.chat,
      { text: `Unknown verb *${verb}*. Use \`.github help\` to see options.` },
      { quoted: m });
  },
};