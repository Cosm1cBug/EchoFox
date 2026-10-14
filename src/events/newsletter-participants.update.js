/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * newsletter-participants.update — Baileys 7.x channel membership change.
 * Payload: { sock, u: { id, author, user, new_role, action } }
 *
 * Why this file exists
 * --------------------
 * The previous wiring subscribed to `newsletter.upsert` and
 * `newsletters.update`. Neither name exists in Baileys 6.7.24 OR 7.x, and
 * `sock.ev.on()` silently accepts unknown events — so those two handlers
 * never ran in production, and `store.upsertNewsletter()` was never called
 * from anywhere. The dashboard's Newsletters tab therefore always rendered
 * empty.
 *
 * v7's actual channel-related events are:
 *   newsletter-participants.update   (this one)
 *   newsletter-settings.update
 *   newsletter.reaction / newsletter.view
 *
 * The participant payload carries no channel metadata, so we use the event
 * as a trigger to refresh metadata explicitly via
 * `sock.newsletterMetadata('jid', id)` and upsert the result. That keeps the
 * store populated instead of permanently empty.
 */

const logger = require('../core/logger').child({ mod: 'newsletter-participants.update' });
const { getStore } = require('../store/instance');

/** Channels refresh at most once per hour — the event is chatty. */
const REFRESH_TTL_MS = 60 * 60 * 1000;
const _lastRefresh = new Map();

module.exports = async ({ sock, u }) => {
  if (!u) return;
  const list = Array.isArray(u) ? u : [u];
  const store = getStore();

  for (const ev of list) {
    const id = ev?.id || ev?.newsletter_id || ev?.jid;
    if (!id) continue;

    logger.debug({ id, action: ev?.action, role: ev?.new_role }, 'channel membership change');

    // Trigger a metadata refresh, throttled per channel.
    const last = _lastRefresh.get(id) || 0;
    if (Date.now() - last < REFRESH_TTL_MS) continue;
    _lastRefresh.set(id, Date.now());

    if (!store?.upsertNewsletter || typeof sock?.newsletterMetadata !== 'function') continue;

    try {
      const meta = await sock.newsletterMetadata('jid', id);
      if (!meta) continue;
      await store.upsertNewsletter(meta.id || id, {
        name: meta.name ?? meta.thread_metadata?.name?.text,
        description: meta.description ?? meta.thread_metadata?.description?.text,
        picture_url: meta.picture?.url ?? meta.thread_metadata?.picture?.url,
        subscribers: meta.subscribers ?? meta.thread_metadata?.subscribers_count,
        verification: meta.verification,
        meta,
      });
    } catch (err) {
      logger.debug({ err, id }, 'newsletter metadata refresh failed');
    }
  }
};
