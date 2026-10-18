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
const { recordTimeline, snap, safeGetStore } = require('../lib/timelineLog');

module.exports = async ({ updates }) => {
  if (!Array.isArray(updates) || !updates.length) return;
  let invalidated = 0;
  for (const update of updates) {
    if (update.id) {
      caches.userDevicesCache.del(update.id);
      invalidated++;
      logger.debug({ jid: update.id }, 'userDevicesCache invalidated');
      // v1.21.0 — contact history (dashboard HistoryPanel, domain 'contact'):
      // per-field rows with the previous value when it is cheap to read.
      try {
        const store = safeGetStore();
        const old =
          typeof store?.getContact === 'function' ? await store.getContact(update.id) : null;
        for (const key of Object.keys(update)) {
          if (key === 'id') continue;
          await recordTimeline(store, {
            domain: 'contact',
            entityId: update.id,
            field: key,
            oldValue: snap(old?.[key] ?? old?.[key === 'imgUrl' ? 'img_url' : key]),
            newValue: snap(update[key]),
            source: 'contacts.update',
          });
        }
      } catch (err) {
        logger.debug({ err, jid: update.id }, 'contact timeline write failed');
      }
    }
  }
  if (invalidated > 0) {
    logger.debug({ count: invalidated }, 'contacts.update processed');
  }
};
