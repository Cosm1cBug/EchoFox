/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'group.join-request' });
const { getStore } = require('../store/instance');

/**
 * group.join-request — join-request lifecycle for approval-mode groups.
 *
 * Baileys 7.x payload (verified: Types/Events.ts +
 * Types/GroupMetadata.d.ts):
 *
 *   {
 *     id:             string,   // group JID
 *     author:         string,   // who triggered the lifecycle change
 *     authorPn?:      string,
 *     authorUsername?: string,
 *     participant:    string,   // the would-be member (requesting user)
 *     participantPn?: string,
 *     action: 'created' | 'revoked' | 'rejected',
 *     method?: 'invite_link' | 'linked_group_join' | 'non_admin_add',
 *   }
 *
 * v1.20.2 (E9): previously NOT BOUND — pending requests were invisible
 * until someone ran the `approve` command. Now every lifecycle change is
 * recorded in the existing append-only `group_participants_events` stream
 * using the action vocabulary the schema already defines
 * (src/store/schema/participants.js):
 *
 *   'created'  → 'request'   (pending join-request submitted)
 *   'rejected' → 'reject'    (pending join-request rejected)
 *   'revoked'  → 'revoked'   (requester withdrew — recorded raw, the
 *                             vocabulary has no dedicated verb; this
 *                             matches classifyAction's "unknown — record
 *                             raw" policy and the stream has no CHECK)
 *
 * The dashboard's group history and the participant-history helpers pick
 * these up automatically.
 */
module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  const list = Array.isArray(u) ? u : [u];
  for (const ev of list) {
    const groupJid = ev?.id || ev?.groupId || ev?.jid;
    const participant = ev?.participant || ev?.participantPn || null;
    if (!groupJid || !participant) continue;

    // Map the Baileys lifecycle verb onto the store's action vocabulary
    // (created→request, rejected→reject); anything else is recorded raw
    // ("unknown — record raw" policy) — never invent an action.
    const action =
      ev.action === 'created' ? 'request' : ev.action === 'rejected' ? 'reject' : ev.action;
    if (!action) continue;

    logger.info(
      {
        group: groupJid,
        participant,
        author: ev.author ?? null,
        action: ev.action,
        method: ev.method ?? null,
      },
      'group join-request lifecycle',
    );

    try {
      await store?.recordParticipantEvent?.(
        groupJid,
        participant,
        action,
        ev.author ?? null,
        Math.floor(Date.now() / 1000),
      );
    } catch (err) {
      logger.debug({ err, groupJid, participant }, 'recordParticipantEvent failed');
    }
  }
};
