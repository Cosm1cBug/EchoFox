'use strict';
const logger = require('../core/logger').child({ mod: 'gp.update' });
const { config } = require('../config');

module.exports = async function onGroupParticipants({ sock, u }) {
  const { id, participants, action, author } = u || {};
  if (!id || !participants?.length) return;
  logger.info({ id, action, author, participants }, 'group participants changed');

  if (config.WApp?.GrpUpdates) {
    try {
      await sock.sendMessage(config.WApp.GrpUpdates, {
        text: `[${action}] ${participants.join(', ')} in ${id} (by ${author || 'unknown'})`,
      });
    } catch {}
  }
};
