/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * blocklist.update — incremental blocklist change. Payload:
 *   { sock, u: { blocklist: ['<jid>', ...], type: 'add' | 'remove' } }
 *
 * NOTE: payload has no `store` — pulled from the singleton.
 */

const logger = require('../core/logger').child({ mod: 'blocklist.update' });
const { getStore } = require('../store/instance');

module.exports = async ({ u }) => {
  const list = u?.blocklist;
  const type = u?.type;
  if (!Array.isArray(list) || !type) return;
  const store = getStore();
  if (!store?.addToBlocklist) return;

  for (const jid of list) {
    if (!jid) continue;
    try {
      if (type === 'add') await store.addToBlocklist(jid);
      else if (type === 'remove') await store.removeFromBlocklist(jid);
    } catch (err) {
      logger.debug({ err, jid, type }, 'blocklist mutation failed');
    }
  }
  logger.info({ count: list.length, type }, 'blocklist updated');
};
