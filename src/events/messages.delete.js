/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * messages.delete event.
 *
 *   Fires when WhatsApp tells us a message has been deleted ("This
 *   message was deleted"). We DO NOT actually erase the message body —
 *   we just mark it deleted with a timestamp. This is forensically
 *   useful (moderation, audit) and matches user expectations of bots
 *   that "remember everything."
 *
 *   Payload shape varies by Baileys version:
 *     • { keys: [{remoteJid, id, participant}, …] }                  — array form
 *     • { jid, all: true }                                           — "delete entire chat" form
 *     • single { remoteJid, id }                                     — older
 *
 *   We handle all three and never throw.
 */

const { config } = require('../lib/configLoader');
const logger     = require('../core/logger').child({ mod: 'msg.delete' });

module.exports = async function onMessagesDelete({ sock, store, payload }) {
  if (!payload) return;

  const ts = Math.floor(Date.now() / 1000);

  // ── "Delete all" in a chat: payload = { jid, all: true } ───────────
  if (payload.all && payload.jid) {
    try {
      await store.markChatMessagesDeleted?.(payload.jid, ts);
      logger.info({ jid: payload.jid }, '🗑 all messages in chat marked deleted');
    } catch (e) {
      logger.warn({ err: e, jid: payload.jid }, 'failed to mark chat deletion');
    }
    return;
  }

  // ── Normalise to array of keys ────────────────────────────────────
  let keys = [];
  if (Array.isArray(payload.keys)) keys = payload.keys;
  else if (Array.isArray(payload)) keys = payload;
  else if (payload.key)            keys = [payload.key];
  else if (payload.remoteJid && payload.id) keys = [payload];

  for (const k of keys) {
    if (!k?.id || !k?.remoteJid) continue;
    try {
      await store.markMessageDeleted?.(k.remoteJid, k.id, k.participant || null, ts);
      logger.info({ jid: k.remoteJid, id: k.id, by: k.participant }, '🗑 message deleted');
    } catch (e) {
      logger.warn({ err: e, jid: k.remoteJid, id: k.id }, 'failed to mark deletion');
    }
  }

  // Optional ops-channel notification
  if (keys.length && config.channels.botLogs) {
    const summary = keys.slice(0, 5).map((k) =>
      `\`${k.remoteJid?.split('@')[0] || '?'}\`/\`${k.id}\``).join(', ');
    const more = keys.length > 5 ? ` and ${keys.length - 5} more` : '';
    sock.sendMessage(config.channels.botLogs, {
      text: `🗑 ${keys.length} message(s) deleted: ${summary}${more}`,
    }, { skipPresence: true }).catch(() => {});
  }
};
