/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Telegram routing (v1.3.0).
 *
 *   resolve(channelKey)        -> string chatId, or null if not routed
 *   listRoutes()               -> [{ key, chatId }] of configured forwards
 *
 * Channel keys mirror config.channels.* — syslogs / botLogs / userLogs /
 * groupUpdates / callLogs / errLogs / movGroup.
 */
const { config } = require('../../lib/configLoader');

const KNOWN_KEYS = Object.freeze([
  'syslogs',
  'botLogs',
  'userLogs',
  'groupUpdates',
  'callLogs',
  'errLogs',
  'movGroup',
]);

function resolve(channelKey) {
  if (!config.telegram?.enabled) return null;
  const r = config.telegram?.routing || {};
  const v = r[channelKey];
  if (!v || typeof v !== 'string') return null;
  return v;
}

function listRoutes() {
  if (!config.telegram?.enabled) return [];
  const r = config.telegram?.routing || {};
  return KNOWN_KEYS
    .map((k) => ({ key: k, chatId: r[k] }))
    .filter((x) => x.chatId);
}

module.exports = { resolve, listRoutes, KNOWN_KEYS };
