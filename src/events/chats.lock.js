/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'chats.lock' });

/**
 * chats.lock — a chat was locked/unlocked (WhatsApp's chat-lock feature).
 *
 * Baileys 7.x payload (verified: Types/Events.ts):
 *   { id: string, locked: boolean }
 *
 * v1.20.2 (E9): previously NOT BOUND (silently dropped). EchoFox keeps no
 * chat-lock state (the store schema has no such field and the dashboard
 * does not surface it), so this binding observes the change in the logs —
 * events are no longer unobserved. Persist here if the dashboard ever
 * shows chat locks.
 */
module.exports = async ({ u }) => {
  if (!u) return;
  const list = Array.isArray(u) ? u : [u];
  for (const ev of list) {
    if (!ev?.id) continue;
    logger.info({ chat: ev.id, locked: !!ev.locked }, 'chat lock state changed');
  }
};
