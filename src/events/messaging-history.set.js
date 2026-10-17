/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * messaging-history.set handler — history sync (initial + on-demand).
 *
 * Baileys delivers history batches ONLY through this event's payload —
 * the messages[] array here is NOT re-emitted via `messages.upsert`
 * (verified against Baileys 7.0.0-rc14 `Utils/process-message.ts`, the
 * single emit site). Every chunk therefore has to be persisted here:
 *
 *   1. messages[]      → store.saveMessages()  (v1.20.0 — same filter
 *                        pipeline as the live messages.upsert path:
 *                        privacy exclusions + non-human content)
 *   2. chats[]         → store.saveChat()      (v1.20.0 — was calling
 *                        store.saveChat/saveContact which no backend
 *                        implemented, so the old handler silently
 *                        persisted NOTHING)
 *   3. contacts[]      → store.bulkUpsertContacts()
 *   4. lidPnMappings[] → store.setLidMapping(lid, pn) — the app-level
 *                        lid_mapping table (the Signal key store gets its
 *                        own copy internally via storeLIDPNMappings)
 *
 * Ignored (by design): pastParticipants (would need leaveReason mapping
 * onto the participant-event vocabulary), progress/syncType/chunkOrder/
 * peerDataRequestSessionId (logged only).
 */
const logger = require('../core/logger');

const log = logger.child({ mod: 'messaging-history.set' });

module.exports = async ({ sock: _sock, store, payload }) => {
  if (!payload || !store) return;

  const {
    chats = [],
    contacts = [],
    messages = [],
    lidPnMappings = [],
    isLatest,
    progress,
    syncType,
    chunkOrder,
    peerDataRequestSessionId,
  } = payload;

  log.info(
    {
      phase: 'history-sync',
      chats: chats.length,
      contacts: contacts.length,
      messages: messages.length,
      lidPnMappings: lidPnMappings.length,
      isLatest: isLatest ?? null,
      progress: progress ?? null,
      syncType: syncType ?? null,
      chunkOrder: chunkOrder ?? null,
      peerDataRequestSessionId: peerDataRequestSessionId ?? null,
    },
    'History Sync Received',
  );

  // ── 1. Messages (bulk — history chunks can hold thousands) ──────────
  if (messages.length) {
    if (typeof store.saveMessages === 'function') {
      try {
        const n = await store.saveMessages(messages);
        log.debug({ offered: messages.length, saved: n }, 'history messages persisted');
      } catch (err) {
        log.warn({ err, count: messages.length }, 'failed to persist history messages');
      }
    } else {
      // Old custom store without the v1.20.0 API — say so loudly instead
      // of silently dropping the batch like the pre-E1 handler did.
      log.warn(
        { count: messages.length },
        'store has no saveMessages() — history messages NOT persisted (update your store)',
      );
    }
  }

  // ── 2. Chats ────────────────────────────────────────────────────────
  for (const chat of chats) {
    if (!chat?.id) continue;
    try {
      if (typeof store.saveChat === 'function') {
        await store.saveChat(chat);
      } else {
        // Minimal fallback: the fields updateChat can carry.
        await store.updateChat?.(chat.id, {
          name: chat.name,
          unread: chat.unreadCount != null ? Number(chat.unreadCount) || 0 : undefined,
          ts: chat.conversationTimestamp != null ? Number(chat.conversationTimestamp) : undefined,
          pinned: chat.pinned,
          muted_until: chat.mute,
          archived: chat.archived,
        });
      }
    } catch (err) {
      log.debug({ err, jid: chat.id }, 'failed to save chat during history sync');
    }
  }

  // ── 3. Contacts (bulk — existing API on every backend) ──────────────
  if (contacts.length && typeof store.bulkUpsertContacts === 'function') {
    try {
      const n = await store.bulkUpsertContacts(contacts);
      log.debug({ offered: contacts.length, saved: n }, 'history contacts persisted');
    } catch (err) {
      log.warn({ err, count: contacts.length }, 'failed to persist history contacts');
    }
  }

  // ── 4. LID ↔ PN mappings learned from the sync ──────────────────────
  if (lidPnMappings.length && typeof store.setLidMapping === 'function') {
    let saved = 0;
    for (const m of lidPnMappings) {
      const lid = m?.lid;
      const pn = m?.pn;
      if (!lid || !pn) continue;
      try {
        await store.setLidMapping(lid, pn);
        saved++;
      } catch (err) {
        log.debug({ err, lid, pn }, 'setLidMapping failed during history sync');
      }
    }
    if (saved) log.debug({ saved }, 'history lid-pn mappings persisted');
  }
};
