/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .alienvault <on|off|status|-status|help>
 *
 *   Subscribe to AlienVault OTX pulse digests delivered by the bot's
 *   hourly cron (see services/alienvaultService.js).
 */

const { getStore } = require('../../store/instance');
const logger = require('../../core/logger').child({ mod: 'alienvault-cmd' });

const VERBS_ON     = new Set(['on', 'enable', 'subscribe']);
const VERBS_OFF    = new Set(['off', 'disable', 'unsubscribe']);
const VERBS_STATUS = new Set(['status', '-status', '--status']);
const VERBS_HELP   = new Set(['help', '-help', '--help', '?']);

module.exports = {
  name: 'alienvault',
  alias: ['pulse'],
  usage: `<on/off/status>`,
  type: 'general',
  info: 'Subscribe to AlienVault OTX threat-pulse digests.',
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

    // ─── on / subscribe ───────────────────────────────────────────────
    if (VERBS_ON.has(verb)) {
      const wasAlready = await store.isSubscriber('alienvault', jid);
      if (wasAlready) {
        return await sock.sendMessage(m.chat,
          { text: '☑️ You are already subscribed to AlienVault pulses.' },
          { quoted: m });
      }
      await store.addSubscriber('alienvault', jid);
      logger.info({ jid, action: 'subscribe' }, 'subscriber added');
      return await sock.sendMessage(m.chat,
        { text: '✅ Subscribed to AlienVault pulses.\n_Use `.alienvault -status` to check at any time._' },
        { quoted: m });
    }

    // ─── off / unsubscribe ────────────────────────────────────────────
    if (VERBS_OFF.has(verb)) {
      const wasSubscribed = await store.isSubscriber('alienvault', jid);
      if (!wasSubscribed) {
        return await sock.sendMessage(m.chat,
          { text: 'ℹ️ You were not subscribed to AlienVault pulses.' },
          { quoted: m });
      }
      await store.removeSubscriber('alienvault', jid);
      logger.info({ jid, action: 'unsubscribe' }, 'subscriber removed');
      return await sock.sendMessage(m.chat,
        { text: '❌ Unsubscribed from AlienVault pulses.' },
        { quoted: m });
    }

    // ─── status / -status ─────────────────────────────────────────────
    if (VERBS_STATUS.has(verb)) {
      const subscribed = await store.isSubscriber('alienvault', jid);
      if (!subscribed) {
        return await sock.sendMessage(m.chat,
          { text: '📭 *AlienVault subscription*\n\nYou are NOT subscribed.\nUse `.alienvault on` to subscribe.' },
          { quoted: m });
      }
      // Look up the subscriber row to show last-seen pulse timestamp
      const subscribers = await store.getSubscribers('alienvault');
      const me = subscribers.find((s) => s.jid === jid);
      const lastSeen = me?.last_seen_pulse_ts;
      const lastSeenStr = lastSeen
        ? new Date(Number(lastSeen)).toLocaleString()
        : '_never (no pulses delivered yet)_';
      return await sock.sendMessage(m.chat, {
        text: [
          '📬 *AlienVault subscription*',
          '',
          '✅ Subscribed: *yes*',
          `🕘 Last pulse delivered: ${lastSeenStr}`,
          '',
          '_Use `.alienvault off` to unsubscribe._',
        ].join('\n'),
      }, { quoted: m });
    }

    // ─── help / unknown ───────────────────────────────────────────────
    if (VERBS_HELP.has(verb) || verb === '') {
      return await sock.sendMessage(m.chat, {
        text: [
          '🛡️ *AlienVault Pulse Subscription*',
          '',
          'Receive curated threat-intelligence pulse digests from',
          'AlienVault OTX, delivered every hour.',
          '',
          '*Commands*',
          '• `.alienvault on`       — subscribe',
          '• `.alienvault off`      — unsubscribe',
          '• `.alienvault -status`  — show your subscription state',
          '• `.alienvault help`     — show this message',
        ].join('\n'),
      }, { quoted: m });
    }

    return await sock.sendMessage(m.chat,
      { text: `Unknown verb *${text}*. Use \`.alienvault help\` to see options.` },
      { quoted: m });
  },
};