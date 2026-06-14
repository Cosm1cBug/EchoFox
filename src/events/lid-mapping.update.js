/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * lid-mapping.update — Baileys 7.x LID ↔ JID mapping refresh. Payload:
 *   { sock, u: { lid, jid, ... } | [...] }
 *
 * LIDs are anonymous identifiers WhatsApp uses for new device-bound
 * accounts. They have to be resolved to real JIDs for the bot to know
 * who's who in groups. Persisting the mapping means we can resolve old
 * LIDs even after a Baileys cache flush.
 *
 * NOTE: payload has no `store` — pulled from the singleton.
 */

const logger = require('../core/logger').child({ mod: 'lid-mapping.update' });
const { getStore } = require('../store/instance');

module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.setLidMapping) return;

  const list = Array.isArray(u) ? u : [u];
  let count = 0;
  for (const ev of list) {
    const lid = ev?.lid || ev?.lidJid;
    const jid = ev?.jid || ev?.whatsappJid;
    if (!lid || !jid) continue;
    try {
      await store.setLidMapping(lid, jid);
      count++;
    } catch (err) {
      logger.debug({ err, lid, jid }, 'setLidMapping failed');
    }
  }
  if (count) logger.info({ count }, 'lid-mapping persisted');
};
