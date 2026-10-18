/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * blocklist.set — Baileys initial sync of the blocklist. Payload:
 *   { sock, u: { blocklist: ['<jid>', '<jid>', ...] } }
 *
 * Replaces our stored blocklist wholesale. Subsequent diffs come via
 * blocklist.update.
 *
 * NOTE: payload has no `store` — pulled from the singleton.
 */

const logger = require('../core/logger').child({ mod: 'blocklist.set' });
const { getStore } = require('../store/instance');
const { recordTimeline } = require('../lib/timelineLog');

module.exports = async ({ u }) => {
  const list = u?.blocklist;
  if (!Array.isArray(list)) return;
  const store = getStore();
  if (!store?.setBlocklist) return;
  try {
    // v1.21.0 — diff against the previous snapshot so the blocklist history
    // records the actual adds/removes (a full snapshot replaces the rows).
    const prev = new Set(
      ((typeof store.getBlocklist === 'function' ? await store.getBlocklist() : []) || []).map(
        (r) => (typeof r === 'string' ? r : r?.jid),
      ),
    );
    await store.setBlocklist(list);
    const next = new Set(list);
    for (const jid of list) {
      if (!prev.has(jid)) {
        await recordTimeline(store, {
          domain: 'blocklist',
          entityId: jid,
          field: 'blocked',
          newValue: 'true',
          source: 'blocklist.set',
        });
      }
    }
    for (const jid of prev) {
      if (!next.has(jid)) {
        await recordTimeline(store, {
          domain: 'blocklist',
          entityId: jid,
          field: 'blocked',
          oldValue: 'true',
          newValue: 'false',
          source: 'blocklist.set',
        });
      }
    }
    logger.info({ count: list.length }, 'blocklist set (full snapshot)');
  } catch (err) {
    logger.warn({ err }, 'setBlocklist failed');
  }
};
