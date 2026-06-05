/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const store = require('../../store/db');

module.exports = {
  name: 'thehackersnews',
  alias: ['thn', 'hackernews', 'cybernews'],
  usage: `<on/off>`,
  type: 'general',
  info: 'Subscribe to The Hacker News cybersecurity articles.',
  start: async (sock, m, { text }) => {
    if (!m.isPrivate) {
      return await sock.sendMessage(m.chat, { text: '❌ Can only be used in Private Chats.' }, { quoted: m });
    }

    const jid = String(m.sender || m.from);

    if (['on', 'enable', 'subscribe'].includes(text)) {
      await store.addSubscriber('thehackersnews', jid);
      await sock.sendMessage(m.chat, { text: '✅ Subscribed to The Hacker News.' }, { quoted: m });
    } 
    else if (['off', 'disable', 'unsubscribe'].includes(text)) {
      await store.removeSubscriber('thehackersnews', jid);
      await sock.sendMessage(m.chat, { text: '❌ Unsubscribed from The Hacker News.' }, { quoted: m });
    } 
    else {
      await sock.sendMessage(m.chat, { text: 'Use .thehackersnews on or .thehackersnews off' }, { quoted: m });
    }
  }
};