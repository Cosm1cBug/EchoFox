/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .tts <lang>?
 *
 * Reply to a text message with `.tts` to get a voice audio reply.
 * Optional ISO 639-1 code (`.tts fr`) translates the text first.
 *
 * v1.1.1: Uses the multi-provider TTS facade (src/services/tts/).
 * Default provider is Edge TTS (msedge-tts) — high-quality neural
 * voices, free, no setup. Switch via config.tts.provider.
 */

const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');
const translate = require('google-translate-api-x');
const tts = require('../../services/tts');
const { config } = require('../../lib/configLoader');

const DEFAULT_LANG = 'en';
const SUPPORTED_LANGS = new Set([
  'af','ar','bn','bs','ca','cs','cy','da','de','el','en','eo','es','et','fi','fr',
  'gu','hi','hr','hu','hy','id','is','it','ja','jw','km','kn','ko','la','lv','mk',
  'ml','mr','my','ne','nl','no','pl','pt','ro','ru','si','sk','sq','sr','su','sv',
  'sw','ta','te','th','tl','tr','uk','ur','vi','zh','zh-cn','zh-tw',
]);

module.exports = {
  name: 'tts',
  alias: ['text2speech', 'speak'],
  desc: 'Convert quoted text to speech. Optional 2-letter language code translates first.',
  category: 'convert',
  cooldown: 5,
  timeout: 120,

  async start(sock, m, { ctx, args }) {
    const text = (ctx.quoted?.text || '').trim();
    if (!text) {
      return ctx.reply('↩️ Reply to a *text* message with `.tts` to get an audio reply.');
    }

    const maxChars = config.tts?.maxChars ?? 8000;
    if (text.length > maxChars) {
      return ctx.reply(`🚫 Text too long (${text.length} chars). Max is ${maxChars}.`);
    }

    const lang = (args[0] || DEFAULT_LANG).toLowerCase();
    if (!SUPPORTED_LANGS.has(lang)) {
      return ctx.reply(`Unsupported language *${lang}*. Try: en, hi, es, fr, de, ja, ko, ml, ta…`);
    }

    let speakText = text;
    if (args[0] && lang !== DEFAULT_LANG) {
      await ctx.react('🌐');
      try {
        const result = await translate(text, { to: lang });
        if (result?.text) speakText = result.text;
      } catch (err) {
        ctx.logger?.warn?.({ err }, 'tts: translation failed; speaking original text');
      }
    }

    await ctx.react('🎤');

    try {
      const audio = await tts.synthesize(speakText, { lang });
      const tmpDir = path.join(os.tmpdir(), 'echofox-tts');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const outPath = path.join(tmpDir, `tts-${Date.now()}.mp3`);
      fs.writeFileSync(outPath, audio);

      await sock.sendMessage(ctx.from, {
        audio: { url: outPath },
        mimetype: 'audio/mpeg',
        ptt: true,                                  // send as voice note
      }, { quoted: m });

      // Cleanup async
      setTimeout(() => { try { fs.rmSync(outPath, { force: true }); } catch {} }, 60_000).unref();

      await ctx.react('✅');
    } catch (err) {
      ctx.logger?.error?.({ err, provider: config.tts?.provider }, 'tts: synthesis failed');
      await ctx.react('❌');
      const provider = config.tts?.provider || 'edge';
      throw new Error(`TTS (${provider}) failed: ${err.message}`);
    }
  },
};