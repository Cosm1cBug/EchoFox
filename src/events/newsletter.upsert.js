/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger');

const log = logger.child({ mod: 'newsletter.upsert' });

module.exports = async ({ u }) => {
  if (!u) return;
  // Baileys emits one or more newsletter objects; payload can be array OR single
  const newsletters = Array.isArray(u) ? u : [u];
  log.info({ count: newsletters.length, newsletters }, 'newsletter.upsert received');
};