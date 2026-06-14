/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .thehackersnews <on [topic1 topic2 ...] | off | status | latest | help>
 *
 *   Subscribe to The Hacker News article digests. Optional topic
 *   filtering matches against the RSS <category> tags on each article;
 *   if no topics are specified, you receive all articles.
 */

const { getStore } = require('../../store/instance');
const { fetchLatestArticles } = require('../../services/thehackersnewsService');
const logger = require('../../core/logger').child({ mod: 'thehackersnews-cmd' });

const VERBS_ON = new Set(['on', 'enable', 'subscribe']);
const VERBS_OFF = new Set(['off', 'disable', 'unsubscribe']);
const VERBS_STATUS = new Set(['status', '-status', '--status']);
const VERBS_HELP = new Set(['help', '-help', '--help', '?']);

function parseTopics(rest) {
  // Lowercase, trim, deduplicate, drop empties. Cap at 10 to prevent abuse.
  const seen = new Set();
  for (const word of rest.split(/\s+/)) {
    const t = word.trim().toLowerCase();
    if (t) seen.add(t);
  }
  return Array.from(seen).slice(0, 10);
}

module.exports = {
  name: 'thehackersnews',
  alias: ['thn', 'hackernews', 'cybernews'],
  usage: `<on [topics...] | off | status | latest>`,
  type: 'general',
  info: 'Subscribe to The Hacker News digests (with optional topic filter).',
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

    // ─── on [topics...] ───────────────────────────────────────────────
    if (VERBS_ON.has(verb)) {
      const topics = parseTopics(rest);
      const meta = topics.length ? { topics } : null;

      const wasAlready = await store.isSubscriber('thehackersnews', jid);
      if (wasAlready) {
        // Update the topics on the existing subscription
        await store.updateSubscriberMeta('thehackersnews', jid, meta);
        logger.info({ jid, action: 'update-topics', topics }, 'topics updated');
        return await sock.sendMessage(
          m.chat,
          {
            text: topics.length
              ? `☑️ Already subscribed. Topic filter updated → *${topics.join(', ')}*.`
              : `☑️ Already subscribed. Topic filter cleared (all articles).`,
          },
          { quoted: m },
        );
      }

      await store.addSubscriber('thehackersnews', jid, meta);
      logger.info({ jid, action: 'subscribe', topics }, 'subscriber added');
      return await sock.sendMessage(
        m.chat,
        {
          text: topics.length
            ? `✅ Subscribed to The Hacker News (topics: *${topics.join(', ')}*).\n_Articles matching ANY of these tags will be delivered._`
            : `✅ Subscribed to The Hacker News (all articles).\n_Use \`.thehackersnews on <topic1> <topic2>\` to filter by tag._`,
        },
        { quoted: m },
      );
    }

    // ─── off ──────────────────────────────────────────────────────────
    if (VERBS_OFF.has(verb)) {
      const wasSubscribed = await store.isSubscriber('thehackersnews', jid);
      if (!wasSubscribed) {
        return await sock.sendMessage(
          m.chat,
          { text: 'ℹ️ You were not subscribed to The Hacker News.' },
          { quoted: m },
        );
      }
      await store.removeSubscriber('thehackersnews', jid);
      logger.info({ jid, action: 'unsubscribe' }, 'subscriber removed');
      return await sock.sendMessage(
        m.chat,
        { text: '❌ Unsubscribed from The Hacker News.' },
        { quoted: m },
      );
    }

    // ─── status / -status ─────────────────────────────────────────────
    if (VERBS_STATUS.has(verb)) {
      const subscribed = await store.isSubscriber('thehackersnews', jid);
      if (!subscribed) {
        return await sock.sendMessage(
          m.chat,
          {
            text: '📭 *The Hacker News subscription*\n\nYou are NOT subscribed.\nUse `.thehackersnews on` to subscribe.',
          },
          { quoted: m },
        );
      }
      const meta = await store.getSubscriberMeta('thehackersnews', jid);
      const topics = meta && Array.isArray(meta.topics) ? meta.topics : [];
      const topicsLine = topics.length
        ? `*${topics.join(', ')}*`
        : '_(no filter — all articles delivered)_';
      return await sock.sendMessage(
        m.chat,
        {
          text: [
            '📬 *The Hacker News subscription*',
            '',
            '✅ Subscribed: *yes*',
            `🏷️ Topic filter: ${topicsLine}`,
            '',
            '_Use `.thehackersnews on <topic1> <topic2>` to change topics._',
            '_Use `.thehackersnews off` to unsubscribe._',
          ].join('\n'),
        },
        { quoted: m },
      );
    }

    // ─── latest ───────────────────────────────────────────────────────
    if (verb === 'latest') {
      const articles = await fetchLatestArticles(5);
      if (!articles.length) {
        return await sock.sendMessage(
          m.chat,
          { text: 'No articles found at the moment.' },
          { quoted: m },
        );
      }
      const list = articles.map((a, i) => `${i + 1}. ${a.title}\n   ${a.link}`).join('\n\n');
      return await sock.sendMessage(
        m.chat,
        { text: `🛡️ Latest from The Hacker News:\n\n${list}` },
        { quoted: m },
      );
    }

    // ─── help / unknown / empty ───────────────────────────────────────
    if (VERBS_HELP.has(verb) || verb === '') {
      return await sock.sendMessage(
        m.chat,
        {
          text: [
            '🛡️ *The Hacker News Subscription*',
            '',
            'Receive cybersecurity article digests from The Hacker News,',
            'delivered every hour.',
            '',
            '*Commands*',
            '• `.thehackersnews on`                      — subscribe (all articles)',
            '• `.thehackersnews on malware ransomware`   — subscribe with topic filter',
            '• `.thehackersnews off`                     — unsubscribe',
            '• `.thehackersnews -status`                 — show your subscription state',
            '• `.thehackersnews latest`                  — fetch the latest 5 articles now',
            '• `.thehackersnews help`                    — show this message',
            '',
            '_Topic filter matches RSS <category> tags (case-insensitive)._',
            '_Articles matching ANY of your topics are delivered._',
          ].join('\n'),
        },
        { quoted: m },
      );
    }

    return await sock.sendMessage(
      m.chat,
      { text: `Unknown verb *${verb}*. Use \`.thehackersnews help\` to see options.` },
      { quoted: m },
    );
  },
};
