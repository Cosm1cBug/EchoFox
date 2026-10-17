/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'labels.association' });
const { getStore } = require('../store/instance');

/**
 * labels.association — a label was attached to / removed from a chat or a
 * message.
 *
 * Baileys 7.x payload (verified: Types/Events.ts + emit site
 * Utils/chat-utils.ts:952):
 *
 *   {
 *     type: 'add' | 'remove',
 *     association:
 *       | { type: 'label_jid',     chatId, labelId }                  // chat
 *       | { type: 'label_message', chatId, messageId, labelId }       // message
 *   }
 *
 * Note the nesting: `labelId` lives INSIDE `association`, and the inner
 * `type` is the LabelAssociationType enum ('label_jid' / 'label_message'),
 * not the add/remove verb (that's the OUTER type).
 *
 * v1.20.0 (E4 fix): the previous handler had three shape bugs and dropped
 * every event:
 *   1. it required a top-level `ev.labelId` (real field: ev.association.labelId)
 *   2. it read `a.chatJid` / `a.jid`          (real field: a.chatId)
 *   3. it expected inner type 'chat'/'message' (real values: 'label_jid'/'label_message')
 * The store side is unchanged: target_type is stored as 'chat'|'message'
 * (enforced by the label_associations CHECK constraint).
 */

/** Map Baileys LabelAssociationType → the store's target_type vocabulary. */
function targetTypeFor(association) {
  if (association?.type === 'label_message') return 'message';
  if (association?.type === 'label_jid') return 'chat';
  // Defensive fallback for hand-built payloads.
  return association?.messageId ? 'message' : 'chat';
}

async function processOne(store, ev) {
  const a = ev?.association;
  if (!a || (ev.type !== 'add' && ev.type !== 'remove')) return;
  const labelId = a.labelId;
  const targetJid = a.chatId || a.chatJid || a.jid;
  if (!labelId || !targetJid) return;

  const targetType = targetTypeFor(a);
  const targetMsgId = a.messageId || null;
  // A message association without a message id is malformed — don't write
  // it as a chat association by accident.
  if (targetType === 'message' && !targetMsgId) return;

  if (ev.type === 'add') {
    await store.associateLabel(labelId, targetType, targetJid, targetMsgId);
  } else {
    await store.disassociateLabel(labelId, targetType, targetJid, targetMsgId);
  }
}

module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.associateLabel) return;
  const events = Array.isArray(u) ? u : [u];
  let count = 0;
  for (const ev of events) {
    try {
      await processOne(store, ev);
      count++;
    } catch (err) {
      logger.debug({ err }, 'label association failed for one event');
    }
  }
  if (count) logger.debug({ count }, 'labels.association processed');
};
