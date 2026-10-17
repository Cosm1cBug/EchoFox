/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'newsletter.reaction' });
const { getStore } = require('../store/instance');

/**
 * newsletter.reaction — someone reacted to a newsletter (channel) message.
 *
 * Baileys 7.x payload (verified: Types/Events.ts + the ONLY emit site,
 * Socket/messages-recv.ts:458):
 *
 *   {
 *     id:        string,          // newsletter JID
 *     server_id: string,          // newsletter message id
 *     reaction:  { code?: string, count?: number, removed?: boolean }
 *                // ^ SINGULAR object — not an array
 *   }
 *
 * v1.20.0 (E6 fix): the previous handler iterated `ev.reactions` (plural)
 * which the payload never has — `for (const r of reactions)` always looped
 * zero times, so no newsletter reaction was ever recorded. Now it consumes
 * the real `reaction` object (and still accepts an array for robustness).
 *
 * Storage semantics: `newsletter_reactions` is an append-only event log;
 * the read model SUMs `count` per emoji. A `removed` reaction is therefore
 * recorded as a NEGATIVE count row so aggregate totals stay accurate. The
 * single current emit site sends `count: 1` per notification and never sets
 * `removed`, but the type declares both — we honour them.
 */
module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.recordNewsletterReaction) return;
  const list = Array.isArray(u) ? u : [u];
  let count = 0;
  for (const ev of list) {
    const newsletterId = ev?.id || ev?.jid || ev?.newsletter_id;
    // `server_id` is the message id. Do NOT fall back to `ev.id` — that is
    // the newsletter JID, not a message id.
    const messageId = ev?.server_id ?? ev?.messageId ?? null;
    if (!newsletterId || !messageId) continue;

    const reactions = Array.isArray(ev?.reactions)
      ? ev.reactions
      : ev?.reaction
        ? [ev.reaction]
        : [];

    for (const r of reactions) {
      const code = r?.code ?? r?.emoji ?? null;
      const removed = !!r?.removed;
      const n = Math.max(1, Math.abs(Number(r?.count) || 1));
      try {
        // `removed` → negative row: SUM(count) read model decrements.
        await store.recordNewsletterReaction(newsletterId, messageId, code, removed ? -n : n);
        count++;
      } catch (err) {
        logger.debug({ err, newsletterId, messageId }, 'recordNewsletterReaction failed');
      }
    }
  }
  if (count) logger.debug({ count }, 'newsletter.reaction persisted');
};
