/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * newsletter.view — view-counter update for a newsletter (channel) message.
 *
 * Baileys 7.x payload (verified: Types/Events.ts + the ONLY emit site,
 * Socket/messages-recv.js `handleNewsletterNotification` → case 'view'):
 *
 *   { id: string,        // newsletter JID
 *     server_id: string, // newsletter message id
 *     count: number }    // parsed from the notification node content
 *
 * v1.20.2 (E8): the previous handler incremented by 1 and ignored `count`
 * (and fell back to `ev.id` — the newsletter JID — as a message id, writing
 * garbage rows). The notification carries the server's running
 * view-counter VALUE for the message (the emit site parses a variable
 * number from the node content — the sibling `newsletter.reaction` emit
 * hardcodes `count: 1` per event instead), so the local tally is now SET to
 * that value with a monotonic guard (`store.setNewsletterViewCount` →
 * MAX/GREATEST/$max) — idempotent under duplicate/out-of-order notices.
 * Falls back to +1 only when `count` is missing or unparsable.
 *
 * NOTE: this fires frequently for popular newsletters. trace-level log.
 */

const logger = require('../core/logger').child({ mod: 'newsletter.view' });
const { getStore } = require('../store/instance');

module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  const hasSet = typeof store?.setNewsletterViewCount === 'function';
  if (!hasSet && typeof store?.incrementNewsletterView !== 'function') return;

  const list = Array.isArray(u) ? u : [u];
  let applied = 0;
  for (const ev of list) {
    const newsletterId = ev?.id || ev?.jid || ev?.newsletter_id;
    // `server_id` is the message id. Do NOT fall back to `ev.id` — that is
    // the newsletter JID, not a message id.
    const messageId = ev?.server_id ?? ev?.messageId ?? null;
    if (!newsletterId || !messageId) continue;
    const n = Number(ev?.count);
    try {
      if (hasSet && Number.isFinite(n) && n >= 0) {
        await store.setNewsletterViewCount(newsletterId, messageId, Math.floor(n));
      } else {
        await store.incrementNewsletterView(newsletterId, messageId);
      }
      applied++;
    } catch (err) {
      logger.debug({ err, newsletterId, messageId }, 'newsletter.view persist failed');
    }
  }
  if (applied) logger.trace({ count: applied }, 'newsletter.view updates recorded');
};
