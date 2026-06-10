/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Google free TTS provider — the translate.google.com TTS endpoint.
 * Lower quality than Edge but very simple. No voice variants — you
 * just pick a language.
 *
 * google-tts-api returns one or more URLs (long text gets chunked).
 * We fetch each URL using axiosWithBreaker and concatenate the MP3
 * buffers (which IS valid for streamed-concat MP3 frames).
 */

const tts = require('google-tts-api');
const { axiosWithBreaker, isOpenBreakerError } = require('../../../lib/network');

async function synthesize(text, opts = {}) {
  const lang = opts.lang || 'en';

  // google-tts-api auto-chunks long text into <= 200-char segments
  const urls = tts.getAllAudioUrls(text, {
    lang,
    slow: false,
    host: 'https://translate.google.com',
  });

  if (!urls.length) throw new Error('google-tts-api returned no URLs');

  const chunks = [];
  for (const u of urls) {
    try {
      const r = await axiosWithBreaker(`google-tts:${lang}`, {
        method:       'GET',
        url:          u.url,
        responseType: 'arraybuffer',
        timeout:      15_000,
        headers:      { 'User-Agent': 'Mozilla/5.0 EchoFox/1.1' },
      });
      chunks.push(Buffer.from(r.data));
    } catch (err) {
      if (isOpenBreakerError(err)) throw new Error('Google TTS overloaded — try again');
      throw err;
    }
  }

  return Buffer.concat(chunks);
}

module.exports = { synthesize };