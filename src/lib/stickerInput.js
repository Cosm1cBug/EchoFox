/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { UserError } = require('./errors');

// wa-sticker-formatter still embeds file-type 16.x. Its ASF detector enters
// the vulnerable loop after matching TEN bytes, not the full 16-byte GUID.
// Reject this format before either main-thread or media-worker construction.
// GHSA-5v7r-6r5c-r473. This is a targeted mitigation, NOT a patched dependency.
const ASF_PREFIX = Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9]);
const MAX_STICKER_BYTES = 8 * 1024 * 1024;

function stickerInput(input) {
  let bytes;
  if (Buffer.isBuffer(input)) bytes = input;
  else if (input instanceof ArrayBuffer) bytes = Buffer.from(input);
  else if (ArrayBuffer.isView(input))
    bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  else
    throw new UserError('Sticker input must be binary media, not a path or URL.', {
      code: 'EUNSUPPORTED_MEDIA',
    });
  if (bytes.length > MAX_STICKER_BYTES)
    throw new UserError('Sticker input exceeds the 8MB limit.', { code: 'EMEDIA_SIZE' });
  if (bytes.subarray(0, ASF_PREFIX.length).equals(ASF_PREFIX))
    throw new UserError('ASF/WMV media is not supported for stickers.', {
      code: 'EUNSUPPORTED_MEDIA',
    });
  return bytes;
}
module.exports = { stickerInput, MAX_STICKER_BYTES };
