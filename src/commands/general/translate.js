/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .translate <lang-code>
 *
 * Reply to a text message with `.translate <lang>` (e.g. `.translate fr`)
 * to get a translation. Source language is auto-detected.
 *
 * Uses google-translate-api-x — no API key, free tier, single-bot friendly.
 */

const { translate } = require('google-translate-api-x');
const iso6391 = require('iso-639-1');

module.exports = {
  name: 'translate',
  alias: ['tr', 'trt'],
  desc: 'Translate a quoted text message to the given language',
  category: 'general',
  cooldown: 3,

  async start(sock, m, { ctx, args }) {
    const target = (args[0] || '').toLowerCase().trim();
    if (!target) {
      return ctx.reply('Usage: reply to a message with `.translate <lang>`\nExample: `.translate fr`');
    }
    if (!iso6391.validate(target)) {
      return ctx.reply(`Unknown language code *${target}*. Use ISO 639-1 (en, fr, de, hi, ml, ja, …).`);
    }

    const source = ctx.quoted?.text;
    if (!source) {
      return ctx.reply('↩️ Reply to a *text* message with this command.');
    }

    await ctx.react('🌐');

    try {
      const res = await translate(source, { to: target });
      const srcName = iso6391.getName(res.from?.language?.iso || 'auto') || 'Auto';
      const tgtName = iso6391.getName(target);

      await ctx.reply(
        `🌐 *${srcName}* → *${tgtName}*\n\n` +
        `_Original:_\n${source}\n\n` +
        `_Translated:_\n${res.text}`,
      );
    } catch (err) {
      throw new Error(`Translation failed: ${err.message}`);
    }
  },
};
