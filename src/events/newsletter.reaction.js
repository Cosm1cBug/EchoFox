/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * newsletter.reaction — emoji reactions on a newsletter message. Payload:
 *   { sock, u: { id|jid, server_id, reactions: [{ code, count }, ...] } | [...] }
 *
 * NOTE: payload has no `store` — pulled from the singleton.
 */

const logger = require('../core/logger').child({ mod: 'newsletter.reaction' });
const { getStore } = require('../store/instance');

module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.recordNewsletterReaction) return;

  const list = Array.isArray(u) ? u : [u];
  let count = 0;
  for (const ev of list) {
    const newsletterId = ev?.id || ev?.jid || ev?.newsletter_id;
    const messageId = ev?.server_id || ev?.messageId || ev?.id;
    if (!newsletterId || !messageId) continue;
    const reactions = ev?.reactions || [];
    for (const r of reactions) {
      try {
        await store.recordNewsletterReaction(
          newsletterId,
          messageId,
          r.code || r.emoji,
          r.count ?? 1,
        );
        count++;
      } catch (err) {
        logger.debug({ err, newsletterId, messageId }, 'recordNewsletterReaction failed');
      }
    }
  }
  if (count) logger.debug({ count }, 'newsletter.reaction persisted');
};
