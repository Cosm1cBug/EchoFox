'use strict';
const logger = require('../core/logger').child({ mod: 'contacts' });

module.exports = function onContactsUpsert({ u }) {
  if (Array.isArray(u)) logger.debug({ count: u.length }, 'contacts upserted');
};
