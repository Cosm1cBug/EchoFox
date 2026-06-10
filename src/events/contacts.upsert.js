/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * contacts.upsert — bulk contact insertion. Payload:
 *   { sock, u: [{ id, name?, notify?, imgUrl?, status?, verifiedName? }, ...] }
 *
 * The store's existing `bind(sock.ev)` handles name/notify/img_url.
 * This handler propagates the v1.1.0 extended fields (status,
 * verifiedName) via bulkUpsertContacts. To avoid duplicate writes for
 * contacts that have no extended fields, we filter first.
 *
 * NOTE: payload has no `store` field — pulled from the singleton.
 */

const logger = require('../core/logger').child({ mod: 'contacts.upsert' });
const { getStore } = require('../store/instance');

module.exports = async ({ u }) => {
  if (!Array.isArray(u) || !u.length) return;
  const store = getStore();
  if (!store?.bulkUpsertContacts) return;
  // Only forward contacts that have AT LEAST ONE extended field worth persisting
  const withExtended = u.filter((c) => c?.id && (c.status != null || c.verifiedName != null));
  if (!withExtended.length) {
    logger.debug({ count: u.length }, 'contacts upserted (baseline only via bind)');
    return;
  }
  try {
    const n = await store.bulkUpsertContacts(withExtended);
    logger.debug({ extended: n, total: u.length }, 'contacts extended fields persisted');
  } catch (err) {
    logger.warn({ err, count: withExtended.length }, 'bulkUpsertContacts failed');
  }
};