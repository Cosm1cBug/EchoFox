/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { getStore } = require('../../store/instance');

module.exports = {
  name: 'alienvault',
  alias: ['pulse'],
  usage: `<on/off>`,
  type: 'general',
  info: 'Subscribe or unsubscribe to AlienVault pulses.',
  start: async (sock, m, { text }) => {
    if (!m.isPrivate) {
      return await sock.sendMessage(
        m.chat,
        { text: '❌ Can only be used in Private Chats.' },
        { quoted: m },
      );
    }

    const jid   = String(m.sender || m.from);
    const store = getStore();
    const verb  = String(text || '').trim().toLowerCase();

    if (['on', 'enable', 'subscribe'].includes(verb)) {
      await store.addSubscriber('alienvault', jid);
      return await sock.sendMessage(
        m.chat,
        { text: '✅ Subscribed to AlienVault pulses.' },
        { quoted: m },
      );
    }

    if (['off', 'disable', 'unsubscribe'].includes(verb)) {
      await store.removeSubscriber('alienvault', jid);
      return await sock.sendMessage(
        m.chat,
        { text: '❌ Unsubscribed from AlienVault pulses.' },
        { quoted: m },
      );
    }

    await sock.sendMessage(
      m.chat,
      { text: 'Use *.alienvault on* or *.alienvault off*' },
      { quoted: m },
    );
  },
};