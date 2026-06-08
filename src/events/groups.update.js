/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * groups.update — Baileys fires this when a group's subject, description,
 * announce-mode, restrict-mode, or invite-code changes. We:
 *
 *   1. Refresh group metadata from the server so the cache stays in sync
 *      (especially the subject — read by many commands + the dashboard).
 *      The old inline worker.js handler did this; it was dropped during
 *      Phase 1's deduplication. Phase 4 restores it here, in the routed
 *      handler, so we maintain a single source of truth.
 *
 *   2. Log interesting fields at INFO so changes are visible in the
 *      log stream + dashboard tail.
 */

const logger = require('../core/logger').child({ mod: 'groups.update' });

module.exports = async function onGroupsUpdate({ sock, store, u }) {
  if (!Array.isArray(u) || !u.length) return;

  for (const update of u) {
    if (!update.id) continue;

    // ── 1. Refresh metadata cache ────────────────────────────────────
    // Best-effort — failure here is logged at debug so the rest of the
    // bot keeps working even if the API call rate-limits us.
    try {
      const fresh = await sock.groupMetadata(update.id);
      await store.saveGroupMetadata(update.id, fresh);
    } catch (e) {
      logger.debug({ err: e, jid: update.id },
        'group metadata refresh failed after groups.update');
    }

    // ── 2. Log structured change details ─────────────────────────────
    if (update.subject) {
      logger.info({ jid: update.id, subject: update.subject }, 'subject changed');
    }
    if (update.desc) {
      logger.info({ jid: update.id }, 'description changed');
    }
    if (update.announce !== undefined) {
      logger.info({ jid: update.id, announce: update.announce }, 'announce-mode changed');
    }
    if (update.restrict !== undefined) {
      logger.info({ jid: update.id, restrict: update.restrict }, 'restrict-mode changed');
    }
  }
};