/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .define <word> — dictionary lookup via Free Dictionary API.
 *
 *   .define serendipity
 *   .define eschew
 *
 * Uses https://dictionaryapi.dev (free, no key, English only).
 * Reuses axiosWithBreaker for retry + circuit-breaker semantics.
 *
 * Returns the first 2 meanings with definition + example.
 */

const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

const MAX_WORD_LEN = 60;
const WORD_RE = /^[a-zA-Z][a-zA-Z'-]*$/;

module.exports = {
  name: 'define',
  alias: ['def', 'dict'],
  desc: 'English dictionary lookup.',
  category: 'tools',
  type: 'tools',
  usage: '<word>',
  cooldown: 5,

  async start(sock, m, { ctx, text }) {
    const word = String(text || '')
      .trim()
      .toLowerCase();
    if (!word) {
      return ctx.reply('📖 *Define*\n\nUsage: `.define <word>`\nExample: `.define serendipity`');
    }
    if (word.length > MAX_WORD_LEN || !WORD_RE.test(word)) {
      return ctx.reply('❌ Use a single English word (letters, apostrophes, hyphens).');
    }

    await ctx.react('📖');

    let data;
    try {
      const resp = await axiosWithBreaker('free-dictionary', {
        method: 'GET',
        url: `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
        timeout: 8000,
        maxContentLength: 200_000,
        maxBodyLength: 200_000,
      });
      data = resp.data;
    } catch (err) {
      if (isOpenBreakerError(err)) {
        return ctx.reply('🌐 Dictionary service is having issues. Try again shortly.');
      }
      if (err?.response?.status === 404) {
        return ctx.reply(`❓ No definition found for *${word}*.`);
      }
      throw err;
    }

    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry?.meanings?.length) {
      return ctx.reply(`❓ No definition found for *${word}*.`);
    }

    const head = `📖 *${entry.word}*` + (entry.phonetic ? `  _${entry.phonetic}_` : '');
    const sections = [];
    for (const meaning of entry.meanings.slice(0, 2)) {
      const pos = meaning.partOfSpeech || '';
      const defs = (meaning.definitions || []).slice(0, 2);
      const lines = defs.map((d, i) => {
        const ex = d.example ? `\n    _e.g._ ${d.example}` : '';
        return `  ${i + 1}. ${d.definition}${ex}`;
      });
      sections.push(`*(${pos})*\n${lines.join('\n')}`);
    }

    return ctx.reply(`${head}\n\n${sections.join('\n\n')}`);
  },
};
