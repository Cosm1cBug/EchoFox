/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * labels.association — label ↔ chat/message links. Payload:
 *   { sock, u: { association: { type: 'chat'|'message', chatJid, messageId? },
 *                type: 'add' | 'remove',
 *                labelId } }
 * Baileys may also batch as an array. Handle both shapes.
 *
 * NOTE: payload has no `store` — pulled from the singleton.
 */

const logger = require('../core/logger').child({ mod: 'labels.association' });
const { getStore } = require('../store/instance');

async function processOne(store, ev) {
  if (!ev?.association || !ev.type || !ev.labelId) return;
  const a = ev.association;
  const targetType = a.type || (a.messageId ? 'message' : 'chat');
  const targetJid = a.chatJid || a.jid;
  const targetMsgId = a.messageId || null;
  if (!targetJid) return;
  if (ev.type === 'add') {
    await store.associateLabel(ev.labelId, targetType, targetJid, targetMsgId);
  } else if (ev.type === 'remove') {
    await store.disassociateLabel(ev.labelId, targetType, targetJid, targetMsgId);
  }
}

module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.associateLabel) return;
  const events = Array.isArray(u) ? u : [u];
  let count = 0;
  for (const ev of events) {
    try { await processOne(store, ev); count++; }
    catch (err) { logger.debug({ err }, 'label association failed for one event'); }
  }
  if (count) logger.debug({ count }, 'labels.association processed');
};
