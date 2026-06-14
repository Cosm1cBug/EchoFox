/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * newsletters.update — partial mutation of one or more newsletters.
 * Worker emits as { sock, u: [...] }. (The EVENT key is plural
 * 'newsletters.update' — handler file kept singular for historical reasons.)
 *
 * Payload per element: { id|jid, name?, description?, picture?, verification?, subscribers? }
 *
 * NOTE: payload has no `store` — pulled from the singleton.
 * NOTE: This rewrite fixes the previous bug where the handler destructured
 * { updates } but the worker emits { sock, u }.
 */

const logger = require('../core/logger').child({ mod: 'newsletter.update' });
const { getStore } = require('../store/instance');

module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.updateNewsletter) return;

  const list = Array.isArray(u) ? u : [u];
  let count = 0;
  for (const n of list) {
    const id = n?.id || n?.jid || n?.newsletter_id;
    if (!id) continue;
    try {
      await store.updateNewsletter(id, {
        name: n.name ?? n.subject,
        description: n.description,
        picture_url: n.picture?.url ?? n.pictureUrl,
        verification: n.verification ?? n.verifiedName,
        subscribers: n.subscribers ?? n.subscribersCount,
        raw: n,
      });
      count++;
    } catch (err) {
      logger.debug({ err, id }, 'newsletter update failed');
    }
  }
  if (count) logger.info({ count }, 'newsletter.update persisted');
};
