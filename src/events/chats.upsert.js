/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * chats.upsert — bulk-create newly-discovered chats. Payload:
 *   { sock, store, u: [{ id, name?, unreadCount?, conversationTimestamp?, pinned?, mute?, archived? }, ...] }
 *
 * The store's existing `bind(sock.ev)` already inserts the basic
 * chat row (jid, name, unread, ts). This handler ADDS the v1.1.0
 * extended fields (pinned, muted_until, archived) on top via updateChat,
 * which COALESCEs so it never wipes the baseline columns.
 */

const logger = require('../core/logger').child({ mod: 'chats.upsert' });
const { recordTimeline, snap } = require('../lib/timelineLog');

module.exports = async ({ store, u }) => {
  if (!Array.isArray(u) || !u.length || !store) return;
  let count = 0;
  for (const c of u) {
    if (!c?.id) continue;
    try {
      await store.updateChat?.(c.id, {
        pinned: c.pinned,
        muted_until: c.mute ?? null,
        archived: c.archived,
      });
      count++;
      // v1.21.0 — chat history for extended fields carried by history sync
      // (same per-field rows as chats.update).
      if (c.pinned !== undefined) {
        await recordTimeline(store, {
          domain: 'chat',
          entityId: c.id,
          field: 'pinned',
          newValue: snap(c.pinned),
          source: 'chats.upsert',
        });
      }
      if (c.mute !== undefined) {
        await recordTimeline(store, {
          domain: 'chat',
          entityId: c.id,
          field: 'muted_until',
          newValue: snap(c.mute),
          source: 'chats.upsert',
        });
      }
      if (c.archived !== undefined) {
        await recordTimeline(store, {
          domain: 'chat',
          entityId: c.id,
          field: 'archived',
          newValue: snap(c.archived),
          source: 'chats.upsert',
        });
      }
    } catch (err) {
      logger.debug({ err, jid: c.id }, 'chat extended-fields update failed');
    }
  }
  if (count) logger.debug({ count }, 'chats extended fields updated');
};
