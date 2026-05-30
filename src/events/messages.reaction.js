/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * messages.reaction event.
 *
 *   Append-only log of every emoji reaction on every tracked message.
 *   Reactions are *toggles* in WhatsApp — when a user removes one, WA
 *   emits the same event with `reaction.text === ''` (or null). We
 *   record BOTH the add and the un-react so the timeline is complete.
 *
 *   Payload shape: [{ key: messageKey, reaction: { text, key: ownKey, senderTimestampMs } }]
 *
 *     • key       — points at the ORIGINAL message being reacted to
 *     • reaction  — the reactor's own message (their key.participant = reactor)
 */

const logger = require('../core/logger').child({ mod: 'msg.reaction' });

module.exports = async function onMessageReaction({ sock, store, payload }) {
  if (!Array.isArray(payload)) return;

  for (const r of payload) {
    const target = r?.key;
    const reactionMsg = r?.reaction;
    if (!target?.id || !target?.remoteJid) continue;

    const reactor = reactionMsg?.key?.participant
                 || reactionMsg?.key?.remoteJid
                 || null;
    const emoji   = reactionMsg?.text || '';                  // '' = removal
    const ts      = Math.floor((Number(reactionMsg?.senderTimestampMs) || Date.now()) / 1000);

    try {
      await store.recordMessageReaction?.(
        target.remoteJid, target.id, reactor, emoji || null, ts,
      );
      logger.debug(
        { jid: target.remoteJid, id: target.id, reactor, emoji: emoji || '(removed)' },
        emoji ? '👍 reaction added' : '🚫 reaction removed',
      );
    } catch (e) {
      logger.warn({ err: e, jid: target.remoteJid, id: target.id }, 'failed to record reaction');
    }
  }
};
