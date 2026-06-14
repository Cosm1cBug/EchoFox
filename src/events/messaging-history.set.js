/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * messaging-history.set handler — initial history sync.
 *
 * Baileys fires this once after a (re)connect with whatever chats /
 * contacts / messages were queued on the WhatsApp server while we were
 * offline. We persist the side-channel metadata (chats + contacts);
 * the messages themselves arrive separately via messages.upsert with
 * type='append' or 'prepend' and are captured by store.bind().
 *
 * The worker's messages.upsert gate ensures these replayed messages
 * are NOT routed to commands — only to the store. That stops the bot
 * from replying to messages older than its start time.
 */
const logger = require('../core/logger');

const log = logger.child({ mod: 'messaging-history.set' });

module.exports = async ({ sock: _sock, store, payload }) => {
  if (!payload) return;

  const { chats = [], contacts = [], messages = [], isLatest } = payload;

  log.info(
    {
      phase: 'history-sync',
      chats: chats.length,
      contacts: contacts.length,
      messages: messages.length,
      isLatest,
    },
    'History Sync Received',
  );

  // Store chats metadata
  if (chats && Array.isArray(chats)) {
    for (const chat of chats) {
      try {
        await store.saveChat?.(chat); // You may need to implement this
      } catch (err) {
        log.debug({ err, jid: chat.id }, 'Failed to save chat during history sync');
      }
    }
  }

  // Store contacts
  if (contacts && Array.isArray(contacts)) {
    for (const contact of contacts) {
      try {
        await store.saveContact?.(contact);
      } catch (err) {
        log.debug({ err, jid: contact.id }, 'Failed to save contact during history sync');
      }
    }
  }

  // Optional: Log only (recommended)
  if (messages && messages.length > 0) {
    log.info(
      `Received ${messages.length} historical messages. They will be processed via messages.upsert.`,
    );
  }
};
