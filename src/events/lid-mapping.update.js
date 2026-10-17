/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'lid-mapping.update' });
const { getStore } = require('../store/instance');

/**
 * lid-mapping.update — a PN ↔ LID pair learned from the wire.
 *
 * Baileys 7.x payload is LIDMapping = { pn, lid } (verified against
 * Types/Auth.ts and BOTH emit sites: messages-recv.ts:431
 * `{ lid, pn }` and chat-utils.ts:974 `{ lid, pn }`).
 *
 * v1.20.0 (E2 fix): the previous handler read `ev.jid` / `ev.whatsappJid`
 * for the PN side — neither field exists — so `if (!lid || !jid) continue`
 * skipped EVERY event and the app-level `lid_mapping` table was never
 * populated from events. The Signal key store still received mappings
 * internally (Baileys' own storeLIDPNMappings), which is why LID features
 * partially worked while `/api/lid-mapping/:lid` always 404'd.
 */
module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.setLidMapping) return;
  const list = Array.isArray(u) ? u : [u];
  let count = 0;
  for (const ev of list) {
    // Canonical v7 shape is `{ pn, lid }`. The extra aliases are cheap
    // defensive fallbacks for hand-built payloads in tests/tools.
    const lid = ev?.lid ?? ev?.lidJid ?? null;
    const pn = ev?.pn ?? ev?.jid ?? ev?.whatsappJid ?? null;
    if (!lid || !pn) continue;
    try {
      await store.setLidMapping(lid, pn);
      count++;
    } catch (err) {
      logger.debug({ err, lid, pn }, 'setLidMapping failed');
    }
  }
  if (count) logger.info({ count }, 'lid-mapping persisted');
};
