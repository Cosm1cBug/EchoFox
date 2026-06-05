/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger');

const log = logger.child({ mod: 'newsletter.upsert' });

module.exports = async ({ sock, newsletters }) => {
  log.info({ newsletters }, 'newsletter.upsert received');
};