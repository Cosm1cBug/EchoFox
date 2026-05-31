/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';
/** Refresh + diff group metadata. The store already caches the fresh copy
 *  via worker.js; here we just log interesting changes. */
const logger = require('../core/logger').child({ mod: 'groups.update' });

module.exports = function onGroupsUpdate({ u }) {
  for (const update of u || []) {
    if (update.subject) logger.info({ jid: update.id, subject: update.subject }, 'subject changed');
    if (update.desc)    logger.info({ jid: update.id }, 'description changed');
  }
};
