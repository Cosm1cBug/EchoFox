/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * message-receipt.update event.
 *
 *   Per-recipient delivery/read/played receipts for messages WE sent.
 *   In group chats this fires once per recipient — so for a group of
 *   100 people you'll see up to 100 events per message as people open it.
 *
 *   Payload: [{ key, receipt: { userJid, receiptTimestamp, readTimestamp, playedTimestamp } }]
 *
 *   Status code we record (per src/store/schema/messages-extras.js):
 *     1 = sent      — implicit (set when we sent the message)
 *     2 = delivered — receiptTimestamp present, no readTimestamp
 *     3 = read      — readTimestamp present
 *     4 = played    — playedTimestamp present (voice notes etc.)
 *
 *   We also bump the *aggregate* `status` column on the message row to
 *   the highest level we've seen so far, so getMessage()-driven views
 *   ("did my message land?") don't need to JOIN.
 */

const { RECEIPT_STATUS } = require('../store/schema/messages-extras');
const logger = require('../core/logger').child({ mod: 'msg.receipt' });

function deriveStatus(r) {
  if (r?.playedTimestamp)   return RECEIPT_STATUS.PLAYED;
  if (r?.readTimestamp)     return RECEIPT_STATUS.READ;
  if (r?.receiptTimestamp)  return RECEIPT_STATUS.DELIVERED;
  return RECEIPT_STATUS.SENT;
}

module.exports = async function onMessageReceipt({ sock, store, payload }) {
  if (!Array.isArray(payload)) return;

  for (const upd of payload) {
    const k = upd?.key;
    const r = upd?.receipt;
    if (!k?.id || !k?.remoteJid || !r) continue;

    const recipient = r.userJid || k.participant || k.remoteJid;
    const status    = deriveStatus(r);
    const ts        = Math.floor(
      (Number(r.playedTimestamp || r.readTimestamp || r.receiptTimestamp) || Date.now()) / 1000,
    );

    try {
      await store.recordReceipt?.(k.remoteJid, k.id, recipient, status, ts);
      // Aggregate: bump messages.status to the highest seen (read/played).
      if (status >= RECEIPT_STATUS.READ) {
        await store.updateMessageStatus?.(k.remoteJid, k.id, status, ts);
      }
    } catch (e) {
      logger.debug({ err: e, jid: k.remoteJid, id: k.id }, 'recordReceipt failed');
    }
  }
};
