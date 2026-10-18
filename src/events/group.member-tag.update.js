/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'group.member-tag.update' });
const { recordTimeline, safeGetStore } = require('../lib/timelineLog');

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
    // v1.21.0 — group history (dashboard Groups page panel, domain 'group').
    await recordTimeline(safeGetStore(), {
      domain: 'group',
      entityId: ev.groupId,
      field: 'member-tag',
      newValue: `${ev.participant} → ${ev.label ?? '(untagged)'}`,
      source: 'group.member-tag.update',
    });
  }
};
