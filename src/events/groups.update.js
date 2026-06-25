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
 *   1. Capture diffs into the group_settings_events log (v1.14.0) BEFORE
 *      refreshing the cache, so we still have the OLD value to compare
 *      against. Tracked fields are defined in
 *      src/store/schema/groupSettingsEvents.js.
 *
 *   2. Refresh group metadata from the server so the cache stays in sync
 *      (especially the subject — read by many commands + the dashboard).
 *
 *   3. Log interesting fields at INFO so changes are visible in the
 *      log stream + dashboard tail.
 *
 * The Baileys update payload only includes the FIELDS THAT CHANGED. To
 * compute a proper old→new diff we re-fetch the full new metadata after
 * persisting changes (via sock.groupMetadata()) and compare against the
 * cached previous metadata we have in the store. This is more reliable
 * than trusting the partial update payload alone, which sometimes omits
 * actors and never includes the previous value.
 */

const logger = require('../core/logger').child({ mod: 'groups.update' });
const { diff, actorForField, serialise } = require('../store/schema/groupSettingsEvents');

module.exports = async function onGroupsUpdate({ sock, store, u }) {
  if (!Array.isArray(u) || !u.length) return;

  for (const update of u) {
    if (!update.id) continue;
    const jid = update.id;

    // ── 1. Snapshot the PREVIOUS metadata BEFORE refreshing the cache.
    //       Best-effort — if we don't have a previous snapshot (fresh
    //       group, store error, etc.) we'll skip diff capture and just
    //       refresh the cache below.
    let oldMeta = null;
    try {
      oldMeta = (await store.getGroupMetadata(jid)) || null;
    } catch (e) {
      logger.debug({ err: e, jid }, 'failed to read previous group metadata');
    }

    // ── 2. Re-fetch authoritative new metadata + save it to the cache.
    let newMeta = null;
    try {
      newMeta = await sock.groupMetadata(jid);
      await store.saveGroupMetadata(jid, newMeta);
    } catch (e) {
      logger.debug({ err: e, jid }, 'group metadata refresh failed after groups.update');
    }

    // ── 3. Compute + persist diff events (v1.14.0).
    //       Only fires when we have both old + new and the store backend
    //       supports recordGroupSettingsChange.
    if (oldMeta && newMeta && typeof store.recordGroupSettingsChange === 'function') {
      try {
        const events = diff(oldMeta, newMeta);
        const now = Math.floor(Date.now() / 1000);
        for (const ev of events) {
          const actor = actorForField(ev.field, newMeta);
          await store.recordGroupSettingsChange(
            jid,
            ev.field,
            serialise(ev.oldValue),
            serialise(ev.newValue),
            actor,
            now,
          );
        }
        if (events.length) {
          logger.info(
            { jid, fields: events.map((e) => e.field) },
            `recorded ${events.length} settings change event(s)`,
          );
        }
      } catch (e) {
        logger.debug({ err: e, jid }, 'diff capture failed');
      }
    }

    // ── 4. Structured INFO logs for the change feed.
    if (update.subject) {
      logger.info({ jid, subject: update.subject }, 'subject changed');
    }
    if (update.desc) {
      logger.info({ jid }, 'description changed');
    }
    if (update.announce !== undefined) {
      logger.info({ jid, announce: update.announce }, 'announce-mode changed');
    }
    if (update.restrict !== undefined) {
      logger.info({ jid, restrict: update.restrict }, 'restrict-mode changed');
    }
  }
};
