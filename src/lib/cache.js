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
