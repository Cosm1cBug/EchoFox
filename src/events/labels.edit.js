/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'labels.edit' });
const { getStore } = require('../store/instance');

/**
 * labels.edit — a WhatsApp Business label was created / renamed / recoloured
 * / deleted.
 *
 * Baileys 7.x payload is a SINGLE `Label` object —
 *   { id, name, color: number, deleted: boolean, predefinedId?: string }
 * (verified: Types/Events.ts `'labels.edit': Label`, the emit site
 * Utils/chat-utils.ts:944, and the buffered-emitter's BUFFERABLE_EVENT list
 * which does NOT batch this event into arrays).
 *
 * v1.20.0 (E3 fix): the previous handler started with
 * `if (!Array.isArray(u) || !u.length) return;` — a single Label object is
 * not an array, so EVERY label event was silently dropped. Normalising to a
 * list keeps the handler correct for both the real single-object payload
 * and any array a test/tool might pass.
 */
module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.upsertLabel) return;
  const list = Array.isArray(u) ? u : [u];
  if (!list.length) return;
  let count = 0;
  for (const lbl of list) {
    if (!lbl?.id) continue;
    try {
      if (lbl.deleted) {
        await store.deleteLabel(lbl.id);
      } else {
        await store.upsertLabel(lbl.id, lbl.name || '(unnamed)', lbl.color);
      }
      count++;
    } catch (err) {
      logger.debug({ err, labelId: lbl.id }, 'label edit propagation failed');
    }
  }
  logger.debug({ count }, 'labels.edit processed');
};
