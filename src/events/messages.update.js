/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * messages.update event.
 *
 *   Baileys emits this for TWO different things on the same channel:
 *
 *     1. EDITS — `update.message` (or `update.message.editedMessage`)
 *        carries the new body. We diff against the stored body, append
 *        a row to `message_edits`, and overwrite the canonical row so
 *        future getMessage() returns the latest version.
 *
 *     2. SEND-STATUS PROGRESSION — `update.status` (Baileys 7.x numeric
 *        enum: 1=sent 2=delivered 3=read 4=played). We treat this as a
 *        per-message status upgrade and record it on the messages row.
 *        (Per-recipient receipts go via message-receipt.update instead.)
 *
 *   `messages.delete` events also come through this channel on some
 *   Baileys versions as `update.messageStubType === REVOKE`; we forward
 *   those to the delete handler.
 */

const logger = require('../core/logger').child({ mod: 'msg.update' });

const STUB_REVOKE = 68;  // proto.WebMessageInfo.StubType.REVOKE in Baileys 7.x

// Extract the text body from a (possibly edited) message payload.
function extractBody(message) {
  if (!message) return '';
  // editedMessage wrapper appeared in WA 2024+
  const edited = message.editedMessage?.message
              || message.protocolMessage?.editedMessage;
  const target = edited || message;
  return (
    target.conversation ||
    target.extendedTextMessage?.text ||
    target.imageMessage?.caption ||
    target.videoMessage?.caption ||
    ''
  );
}

module.exports = async function onMessagesUpdate({ sock: _sock, store, payload }) {
  if (!Array.isArray(payload)) return;

  for (const update of payload) {
    if (!update?.key?.id || !update?.key?.remoteJid) continue;

    const jid = update.key.remoteJid;
    const id  = update.key.id;
    const ts  = Math.floor(Date.now() / 1000);

    // ─── Branch 1: edit ──────────────────────────────────────────────
    const newMessage = update.update?.message || update.message;
    const newBody    = extractBody(newMessage);

    if (newMessage && newBody) {
      try {
        const oldMsg  = await store.getMessage(update.key);
        const oldBody = extractBody(oldMsg);

        if (oldBody !== newBody) {
          await store.recordMessageEdit?.(jid, id, update.key.participant || jid, oldBody, newBody, ts);
          await store.updateMessageBody?.(jid, id, newMessage, ts);
          logger.info({ jid, id, oldLen: oldBody.length, newLen: newBody.length },
            '✏️ message edited');
        }
      } catch (e) {
        logger.warn({ err: e, jid, id }, 'failed to record edit');
      }
    }

    // ─── Branch 2: status progression ────────────────────────────────
    const status = update.update?.status ?? update.status;
    if (typeof status === 'number' && status >= 1 && status <= 4) {
      try {
        await store.updateMessageStatus?.(jid, id, status, ts);
      } catch (e) {
        logger.debug({ err: e, jid, id, status }, 'updateMessageStatus failed');
      }
    }

    // ─── Branch 3: REVOKE (delete) sometimes arrives here ────────────
    const stub = update.update?.messageStubType ?? update.messageStubType;
    if (stub === STUB_REVOKE) {
      try {
        await store.markMessageDeleted?.(jid, id, update.key.participant || null, ts);
        logger.info({ jid, id }, '🗑 message revoked (via update channel)');
      } catch (e) {
        logger.warn({ err: e, jid, id }, 'failed to mark revoked');
      }
    }
  }
};
