/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * chats.delete — Baileys signals chat deletion. Payload:
 *   { sock, store, u: ['<jid>', '<jid>', ...] }
 *
 * We mark each chat as deleted (sets deleted_at) but RETAIN message
 * history — same forensic philosophy as messages.delete.
 */

const logger = require('../core/logger').child({ mod: 'chats.delete' });

module.exports = async ({ store, u }) => {
  if (!Array.isArray(u) || !u.length || !store) return;
  for (const jid of u) {
    if (!jid) continue;
    try {
      await store.markChatDeleted?.(jid);
    } catch (err) {
      logger.debug({ err, jid }, 'markChatDeleted failed');
    }
  }
  logger.info({ count: u.length }, 'chats marked deleted (history retained)');
};