/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * newsletter-settings.update — user's per-newsletter settings (mute, etc.). Payload:
 *   { sock, u: { id|jid, ...settings } | [...] }
 *
 * We store the whole settings blob as JSON; consumers can parse later.
 *
 * NOTE: payload has no `store` — pulled from the singleton.
 */

const logger = require('../core/logger').child({ mod: 'newsletter-settings.update' });
const { getStore } = require('../store/instance');

module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.updateNewsletterSettings) return;

  const list = Array.isArray(u) ? u : [u];
  let count = 0;
  for (const ev of list) {
    const newsletterId = ev?.id || ev?.jid || ev?.newsletter_id;
    if (!newsletterId) continue;
    const settings = { ...ev };
    delete settings.id; delete settings.jid; delete settings.newsletter_id;
    try {
      await store.updateNewsletterSettings(newsletterId, settings);
      count++;
    } catch (err) {
      logger.debug({ err, newsletterId }, 'updateNewsletterSettings failed');
    }
  }
  if (count) logger.debug({ count }, 'newsletter-settings.update persisted');
};