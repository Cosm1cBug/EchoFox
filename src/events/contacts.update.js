/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * contacts.update handler.
 *
 *   When a contact's identity (name / pushname / profile picture / device
 *   list) changes, Baileys fires this event with the affected JIDs. We
 *   invalidate the per-user device cache so the next outbound message
 *   re-resolves devices fresh — important to avoid sending to a device
 *   that no longer exists, which can cause the recipient to receive
 *   duplicate or dropped messages.
 */

const logger = require('../core/logger').child({ mod: 'contacts.update' });
const caches = require('../core/caches');

module.exports = async ({ updates }) => {
  if (!Array.isArray(updates) || !updates.length) return;
  let invalidated = 0;
  for (const update of updates) {
    if (update.id) {
      caches.userDevicesCache.del(update.id);
      invalidated++;
      logger.debug({ jid: update.id }, 'userDevicesCache invalidated');
    }
  }
  if (invalidated > 0) {
    logger.debug({ count: invalidated }, 'contacts.update processed');
  }
};