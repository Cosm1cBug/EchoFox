/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .quote
 *
 * Fetches a random inspirational quote from the public ZenQuotes API
 * (no key required, free for personal use, single-bot-friendly).
 *
 *   Replaces the original `quote.js` which was actually a half-finished
 *   language detector with a hardcoded API key — leak risk + wrong name.
 */

const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

module.exports = {
  name: 'quote',
  alias: ['q', 'inspire'],
  desc: 'Fetch a random inspirational quote',
  category: 'misc',
  cooldown: 5,

  async start(sock, m, { ctx }) {
    try {
      const { data } = await axiosWithBreaker('zenquotes', {
        method: 'GET',
        url: 'https://zenquotes.io/api/random',
        timeout: 8000,
      });
      const q = Array.isArray(data) ? data[0] : data;
      if (!q?.q || !q?.a) throw new Error('upstream returned no quote');
      await ctx.reply(`💬 _"${q.q}"_\n\n— *${q.a}*`);
    } catch (err) {
      if (isOpenBreakerError(err)) {
        throw new Error('⏱️ Quote service is currently overloaded. Try again in ~1 minute.');
      }
      throw new Error(`Could not fetch quote: ${err.message}`);
    }
  },
};
