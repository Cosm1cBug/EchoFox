/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';
/**
 * Backwards-compat shim.
 * Older commands `require('../lib/cache.js')` and expect
 * { metadataCache, retryCache } – we now route them to the central caches.
 */
const c = require('../core/caches');

module.exports = {
  metadataCache:   c.groupMetadataCache,
  retryCache:      c.msgRetryCounterCache,
};
