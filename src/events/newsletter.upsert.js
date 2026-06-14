/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * newsletter.upsert — Baileys announces a newsletter (channel-like). Payload:
 *   { sock, u: <newsletter> | [<newsletter>, ...] }
 *
 * Each `<newsletter>` carries id, name, description, picture, etc.
 * We upsert into the store so AI tools (v1.2.0) can look up channels.
 *
 * NOTE: payload has no `store` — pulled from the singleton.
 */

const logger = require('../core/logger').child({ mod: 'newsletter.upsert' });
const { getStore } = require('../store/instance');

module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.upsertNewsletter) return;

  const list = Array.isArray(u) ? u : [u];
  let count = 0;
  for (const n of list) {
    const id = n?.id || n?.jid || n?.newsletter_id;
    if (!id) continue;
    try {
      await store.upsertNewsletter(id, {
        name: n.name ?? n.subject,
        description: n.description,
        picture_url: n.picture?.url ?? n.pictureUrl,
        verification: n.verification ?? n.verifiedName,
        subscribers: n.subscribers ?? n.subscribersCount,
        raw: n,
        created_at: n.creation ?? n.created_at,
      });
      count++;
    } catch (err) {
      logger.debug({ err, id }, 'newsletter upsert failed');
    }
  }
  if (count) logger.info({ count }, 'newsletter.upsert persisted');
};
