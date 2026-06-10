/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * message-capping.update — per-chat message-cap (storage limit) settings. Payload:
 *   { sock, u: { jid|chatJid, cap_value|cap, ... } | [...] }
 *
 * NOTE: payload has no `store` — pulled from the singleton.
 */

const logger = require('../core/logger').child({ mod: 'message-capping.update' });
const { getStore } = require('../store/instance');

module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.setMessageCap) return;

  const list = Array.isArray(u) ? u : [u];
  let count = 0;
  for (const ev of list) {
    const jid = ev?.jid || ev?.chatJid;
    const cap = ev?.cap_value ?? ev?.cap ?? ev?.maxMessages;
    if (!jid || cap == null) continue;
    try {
      await store.setMessageCap(jid, cap);
      count++;
    } catch (err) {
      logger.debug({ err, jid }, 'setMessageCap failed');
    }
  }
  if (count) logger.info({ count }, 'message-capping persisted');
};