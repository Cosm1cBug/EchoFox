/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const store = require('../../store/db');
const { checkAndDeliver } = require('../../services/alienvaultService');

module.exports = {
  name: 'alienvault',
  alias: ['pulse'],
  usage: `<on/off>`,
  type: 'general',
  info: 'Subscribe or unsubscribe to AlienVault pulses.',
  start: async (sock, m, { text }) => {
    if (!m.isPrivate) {
      return await sock.sendMessage(m.chat, { text: '❌ Can only be used in Private Chats.' }, { quoted: m });
    }

    const jid = String(m.sender || m.from);

    if (['on', 'enable', 'subscribe'].includes(text)) {
      await store.addSubscriber('alienvault', jid);
      await sock.sendMessage(m.chat, { text: '✅ Subscribed to AlienVault pulses.' }, { quoted: m });
    } else if (['off', 'disable', 'unsubscribe'].includes(text)) {
      await store.removeSubscriber('alienvault', jid);
      await sock.sendMessage(m.chat, { text: '❌ Unsubscribed from AlienVault pulses.' }, { quoted: m });
    } else {
      await sock.sendMessage(m.chat, { text: 'Use .alienvault on or .alienvault off' }, { quoted: m });
    }
  }
};