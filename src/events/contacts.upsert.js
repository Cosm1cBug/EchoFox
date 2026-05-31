/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'contacts' });

module.exports = function onContactsUpsert({ u }) {
  if (Array.isArray(u)) logger.debug({ count: u.length }, 'contacts upserted');
};
