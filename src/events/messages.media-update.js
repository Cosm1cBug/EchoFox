/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'messages.media-update' });

/**
 * messages.media-update — result of media re-upload requests
 * (`reuploadRequest`), fired when re-serving expired media.
 *
 * Baileys 7.x payload (verified: Types/Events.ts):
 *   { key: WAMessageKey;
 *     media?: { ciphertext: Uint8Array; iv: Uint8Array };
 *     error?: Boom }[]
 *
 * v1.20.2 (E9): previously NOT BOUND (silently dropped). The dashboard
 * deliberately does not re-serve media (documented in Chat.tsx), so this
 * binding observes outcomes in the logs — errors at warn, successes at
 * debug. Wire real re-serving here if media export is ever implemented.
 */
module.exports = async ({ u }) => {
  if (!Array.isArray(u)) return;
  for (const ev of u) {
    const jid = ev?.key?.remoteJid ?? null;
    const id = ev?.key?.id ?? null;
    if (ev?.error) {
      logger.warn({ err: ev.error, jid, id }, 'media re-upload failed');
    } else {
      logger.debug({ jid, id, hasMedia: !!ev?.media }, 'media re-upload result');
    }
  }
};
