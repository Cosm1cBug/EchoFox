/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * chats.update — partial mutations on existing chats. Payload:
 *   { sock, store, u: [{ id, name?, unreadCount?, conversationTimestamp?, pinned?, mute?, archived? }, ...] }
 *
 * The store's existing `bind(sock.ev)` handles name/unread/ts via
 * chatUpdate prepared stmt. This handler propagates extended-field
 * mutations (pin/mute/archive) via updateChat with COALESCE semantics.
 */

const logger = require('../core/logger').child({ mod: 'chats.update' });
const { recordTimeline, snap } = require('../lib/timelineLog');

module.exports = async ({ store, u }) => {
  if (!Array.isArray(u) || !u.length || !store) return;
  for (const c of u) {
    if (!c?.id) continue;
    try {
      await store.updateChat?.(c.id, {
        pinned: c.pinned,
        muted_until: c.mute,
        archived: c.archived,
      });
      // v1.21.0 — chat history (dashboard HistoryPanel, domain 'chat').
      // One row per field actually present in the update; the timeline's
      // previous row for that field is the old state.
      if (c.pinned !== undefined) {
        await recordTimeline(store, {
          domain: 'chat',
          entityId: c.id,
          field: 'pinned',
          newValue: snap(c.pinned),
          source: 'chats.update',
        });
      }
      if (c.mute !== undefined) {
        await recordTimeline(store, {
          domain: 'chat',
          entityId: c.id,
          field: 'muted_until',
          newValue: snap(c.mute),
          source: 'chats.update',
        });
      }
      if (c.archived !== undefined) {
        await recordTimeline(store, {
          domain: 'chat',
          entityId: c.id,
          field: 'archived',
          newValue: snap(c.archived),
          source: 'chats.update',
        });
      }
    } catch (err) {
      logger.trace({ err, jid: c.id }, 'chat update propagation failed');
    }
  }
};
