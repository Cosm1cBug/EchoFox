/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * labels.edit — WA Business label add/update/delete. Payload:
 *   { sock, u: [{ id, name?, color?, predefinedId?, deleted? }, ...] }
 *
 * NOTE: payload has no `store` — pulled from the singleton.
 */

const logger = require('../core/logger').child({ mod: 'labels.edit' });
const { getStore } = require('../store/instance');

module.exports = async ({ u }) => {
  if (!Array.isArray(u) || !u.length) return;
  const store = getStore();
  if (!store?.upsertLabel) return;

  for (const lbl of u) {
    if (!lbl?.id) continue;
    try {
      if (lbl.deleted) {
        await store.deleteLabel(lbl.id);
      } else {
        await store.upsertLabel(lbl.id, lbl.name || '(unnamed)', lbl.color);
      }
    } catch (err) {
      logger.debug({ err, labelId: lbl.id }, 'label edit propagation failed');
    }
  }
  logger.debug({ count: u.length }, 'labels.edit processed');
};
