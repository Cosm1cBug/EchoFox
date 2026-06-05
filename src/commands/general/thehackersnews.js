/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const store = require('../../store/db');
const { fetchLatestArticles } = require('../services/thehackersnewsService');

module.exports = {
  name: 'thehackersnews',
  alias: ['thn', 'hackernews', 'cybernews'],
  usage: `<on/off/latest>`,
  type: 'general',
  info: 'Subscribe or fetch latest articles from The Hacker News.',
  start: async (sock, m, { text }) => {
    if (!m.isPrivate) {
      return await sock.sendMessage(m.chat, { text: '❌ Can only be used in Private Chats.' }, { quoted: m });
    }

    const jid = String(m.sender || m.from);

    if (['on', 'enable', 'subscribe'].includes(text)) {
      await store.addSubscriber('thehackersnews', jid);
      return await sock.sendMessage(m.chat, { text: '✅ Subscribed to The Hacker News.' }, { quoted: m });
    }

    if (['off', 'disable', 'unsubscribe'].includes(text)) {
      await store.removeSubscriber('thehackersnews', jid);
      return await sock.sendMessage(m.chat, { text: '❌ Unsubscribed from The Hacker News.' }, { quoted: m });
    }

    if (text === 'latest' || text === '') {
      const articles = await fetchLatestArticles(5);
      if (!articles.length) {
        return await sock.sendMessage(m.chat, { text: 'No articles found at the moment.' }, { quoted: m });
      }

      const list = articles.map((a, i) => `${i + 1}. ${a.title}\n   ${a.link}`).join('\n\n');
      return await sock.sendMessage(m.chat, { text: `🛡️ Latest from The Hacker News:\n\n${list}` }, { quoted: m });
    }

    await sock.sendMessage(m.chat, { text: 'Use .thehackersnews on, off, or latest' }, { quoted: m });
  }
};