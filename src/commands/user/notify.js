/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .notify on/off/status   (alias: .notifications)
 *
 * Per-user opt-in for level-up DM notifications (v1.16.0).
 *
 *   .notify on        → start getting a DM each time you level up
 *   .notify off       → stop getting DMs
 *   .notify status    → show current preference + global default
 *   .notify           → same as status (no-arg shortcut)
 *
 * Storage: persisted via store.subscriber_meta under the synthetic
 * service "levelup-notify". One row per user; meta = { optedIn, hintSeen }.
 *
 * Notes:
 *   • Setting is global across all chats — opting out in one group
 *     opts you out everywhere (it's about WHERE the DM goes, not
 *     about a specific chat).
 *   • If you've never run .notify, you follow the global default
 *     (config.leveling.notifications.defaultEnabled; ships OFF).
 *   • On your very first XP gain we send a one-time hint pointing
 *     here. After that hint, we never auto-message you again unless
 *     you opt in.
 */

const { getStore } = require('../../store/instance');
const { NOTIFY_SERVICE, isNotifyEnabled } = require('../../services/levelingService');
const { config } = require('../../lib/configLoader');

const HELP =
  '🔔 *Level-up notifications*\n\n' +
  '`.notify on`      — get a DM each time you level up\n' +
  '`.notify off`     — stop getting DMs\n' +
  '`.notify status`  — see your current setting\n\n' +
  '_Setting is global across all chats._';

module.exports = {
  name: 'notify',
  alias: ['notifications', 'notif'],
  desc: 'Toggle level-up DM notifications.',
  category: 'user',
  type: 'user',
  usage: '[on|off|status]',
  cooldown: 3,

  async start(sock, m, { ctx, args }) {
    const sub = (args[0] || 'status').toLowerCase();
    const store = getStore();
    const userJid = ctx.sender;

    if (!userJid) {
      return ctx.reply('❌ Could not identify your account.');
    }
    if (
      typeof store.addSubscriber !== 'function' ||
      typeof store.getSubscriberMeta !== 'function' ||
      typeof store.updateSubscriberMeta !== 'function'
    ) {
      return ctx.reply('❌ Notifications not supported on this storage backend.');
    }

    if (sub === 'on' || sub === 'enable') {
      const existing = await store.isSubscriber(NOTIFY_SERVICE, userJid).catch(() => false);
      const newMeta = { optedIn: true, hintSeen: true };
      if (!existing) {
        await store.addSubscriber(NOTIFY_SERVICE, userJid, newMeta);
      } else {
        const cur =
          (await store.getSubscriberMeta(NOTIFY_SERVICE, userJid).catch(() => null)) || {};
        await store.updateSubscriberMeta(NOTIFY_SERVICE, userJid, { ...cur, ...newMeta });
      }
      return ctx.reply(
        '🔔 *Level-up notifications: ON*\n\n' +
          "You'll get a DM every time you level up. " +
          'Run `.notify off` to turn it off.',
      );
    }

    if (sub === 'off' || sub === 'disable') {
      const existing = await store.isSubscriber(NOTIFY_SERVICE, userJid).catch(() => false);
      const newMeta = { optedIn: false, hintSeen: true };
      if (!existing) {
        await store.addSubscriber(NOTIFY_SERVICE, userJid, newMeta);
      } else {
        const cur =
          (await store.getSubscriberMeta(NOTIFY_SERVICE, userJid).catch(() => null)) || {};
        await store.updateSubscriberMeta(NOTIFY_SERVICE, userJid, { ...cur, ...newMeta });
      }
      return ctx.reply(
        '🔕 *Level-up notifications: OFF*\n\n' +
          "You won't get DMs when you level up. Run `.notify on` to re-enable.",
      );
    }

    if (sub === 'status' || sub === 'show') {
      const enabled = await isNotifyEnabled(userJid);
      const meta = await store.getSubscriberMeta(NOTIFY_SERVICE, userJid).catch(() => null);
      const explicit = meta && typeof meta.optedIn === 'boolean';
      const globalDefault = !!config?.leveling?.notifications?.defaultEnabled;
      return ctx.reply(
        '🔔 *Level-up notifications*\n\n' +
          `*Your setting:* ${enabled ? '✅ ON' : '🔕 OFF'}` +
          (explicit
            ? ' _(explicit)_'
            : ` _(following global default: ${globalDefault ? 'on' : 'off'})_`) +
          '\n\n' +
          'Use `.notify on` or `.notify off` to change.',
      );
    }

    return ctx.reply(HELP);
  },
};
