/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * newsletter.view — view counter ping for a newsletter message. Payload:
 *   { sock, u: { id|jid, server_id, count? } | [...] }
 *
 * NOTE: payload has no `store` — pulled from the singleton.
 * NOTE: this fires VERY frequently for popular newsletters. trace-level log.
 */

const logger = require('../core/logger').child({ mod: 'newsletter.view' });
const { getStore } = require('../store/instance');

module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.incrementNewsletterView) return;

  const list = Array.isArray(u) ? u : [u];
  let count = 0;
  for (const ev of list) {
    const newsletterId = ev?.id || ev?.jid || ev?.newsletter_id;
    const messageId = ev?.server_id || ev?.messageId || ev?.id;
    if (!newsletterId || !messageId) continue;
    try {
      await store.incrementNewsletterView(newsletterId, messageId);
      count++;
    } catch (err) {
      logger.debug({ err, newsletterId, messageId }, 'incrementNewsletterView failed');
    }
  }
  if (count) logger.trace({ count }, 'newsletter.view ticks recorded');
};
