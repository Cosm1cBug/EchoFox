/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'group.member-tag.update' });

/**
 * group.member-tag.update — participant label (member-tagging) change.
 *
 * Baileys 7.x payload (verified: Types/Events.ts):
 *   { groupId: string,
 *     participant: string,
 *     participantAlt?: string,
 *     label: string,
 *     messageTimestamp?: number }
 *
 * v1.20.2 (E9): previously NOT BOUND (silently dropped). EchoFox stores no
 * member-tag state, so this binding observes the change in the logs.
 */
module.exports = async ({ u }) => {
  if (!u) return;
  const list = Array.isArray(u) ? u : [u];
  for (const ev of list) {
    if (!ev?.groupId || !ev?.participant) continue;
    logger.info(
      {
        group: ev.groupId,
        participant: ev.participant,
        participantAlt: ev.participantAlt ?? null,
        label: ev.label ?? null,
      },
      'group member-tag updated',
    );
  }
};
