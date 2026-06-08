/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'newsletter.update' });

module.exports = async ({ updates }) => {
  if (!Array.isArray(updates) || !updates.length) return;
  logger.info({ count: updates.length, updates }, 'newsletter.update received');
};