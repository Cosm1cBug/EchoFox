/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * blocklist.set — Baileys initial sync of the blocklist. Payload:
 *   { sock, u: { blocklist: ['<jid>', '<jid>', ...] } }
 *
 * Replaces our stored blocklist wholesale. Subsequent diffs come via
 * blocklist.update.
 *
 * NOTE: payload has no `store` — pulled from the singleton.
 */

const logger = require('../core/logger').child({ mod: 'blocklist.set' });
const { getStore } = require('../store/instance');

module.exports = async ({ u }) => {
  const list = u?.blocklist;
  if (!Array.isArray(list)) return;
  const store = getStore();
  if (!store?.setBlocklist) return;
  try {
    await store.setBlocklist(list);
    logger.info({ count: list.length }, 'blocklist set (full snapshot)');
  } catch (err) {
    logger.warn({ err }, 'setBlocklist failed');
  }
};