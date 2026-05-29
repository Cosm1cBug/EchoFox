/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .tts <lang>?
 *
 * Reply to a text message with `.tts` to get an audio voice reply.
 * Optionally pass a 2-letter ISO 639-1 language code (e.g. `.tts fr`) and
 * the bot will translate the text first, then synthesise.
 *
 * Previous version depended on the abandoned `node-tts-ml` package. We now
 * rely exclusively on `node-gtts` (Google Text-to-Speech, MIT-licensed,
 * still maintained) for all languages — it covers 30+ including ML.
 */

const fs        = require('node:fs');
const path      = require('node:path');
const os        = require('node:os');
const gtts      = require('node-gtts');
const translate = require('google-translate-api-x');
const ffmpeg    = require('fluent-ffmpeg');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');

const DEFAULT_LANG = 'en';
const TEMP_TTL_MS  = 24 * 60 * 60 * 1000;        // delete temp files after 24h
const MAX_CHARS    = 4000;                        // Google TTS hard cap

// Languages node-gtts supports — used to validate user input.
// (List taken from node-gtts source; trim aggressively if you only target a subset.)
const SUPPORTED_LANGS = new Set([
  'af','ar','bn','bs','ca','cs','cy','da','de','el','en','eo','es','et','fi','fr',
  'gu','hi','hr','hu','hy','id','is','it','ja','jw','km','kn','ko','la','lv','mk',
  'ml','mr','my','ne','nl','no','pl','pt','ro','ru','si','sk','sq','sr','su','sv',
  'sw','ta','te','th','tl','tr','uk','ur','vi','zh','zh-cn','zh-tw',
]);

function chunkText(text) {
  // Split on sentence boundaries; coalesce so each chunk ≤ MAX_CHARS.
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks    = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > MAX_CHARS) {
      if (buf) chunks.push(buf.trim());
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

function synthesizeChunk(text, lang, outPath) {
  return new Promise((resolve, reject) => {
    try {
      const stream = gtts(lang).stream(text);
      const file   = fs.createWriteStream(outPath);
      stream.pipe(file);
      file.on('finish', () => resolve(outPath));
      file.on('error', reject);
      stream.on('error', reject);
    } catch (e) { reject(e); }
  });
}

function mergeMp3s(inputs, output) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    inputs.forEach((f) => cmd.input(f));
    cmd
      .on('end',  () => resolve(output))
      .on('error', reject)
      .mergeToFile(output, path.dirname(output));
  });
}

module.exports = {
  name: 'tts',
  alias: ['text2speech', 'speak'],
  desc: 'Convert quoted text to speech. Optional: 2-letter language code translates first.',
  category: 'convert',
  cooldown: 5,
  timeout: 90,

  async start(sock, m, { ctx, args }) {
    const text = (ctx.quoted?.message?.conversation
               || ctx.quoted?.message?.extendedTextMessage?.text
               || '').trim();

    if (!text) {
      return ctx.reply('↩️ Reply to a *text* message with `.tts` to get an audio reply.');
    }

    let lang = (args[0] || DEFAULT_LANG).toLowerCase();
    if (!SUPPORTED_LANGS.has(lang)) {
      const sample = ['en', 'hi', 'es', 'fr', 'de', 'ja', 'ko', 'ml', 'ta'].join(', ');
      return ctx.reply(`Unsupported language *${lang}*. Try one of: ${sample}…`);
    }

    let speakText = text;

    // Optional translation step
    if (args[0] && lang !== DEFAULT_LANG) {
      await ctx.react('🌐');
      try {
        const result = await translate(text, { to: lang });
        if (result?.text) speakText = result.text;
      } catch (err) {
        // soft-fail: synthesize original text in target voice
        ctx.logger?.warn?.({ err }, 'tts: translation failed; speaking original text');
      }
    }

    await ctx.react('🎤');

    const tmpDir = path.join(os.tmpdir(), 'echofox-tts');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const ts      = Date.now();
    const chunks  = chunkText(speakText);
    const parts   = [];

    try {
      for (let i = 0; i < chunks.length; i++) {
        const p = path.join(tmpDir, `tts-${ts}-${i}.mp3`);
        await synthesizeChunk(chunks[i], lang, p);
        parts.push(p);
      }

      let final = parts[0];
      if (parts.length > 1) {
        final = path.join(tmpDir, `tts-${ts}-final.mp3`);
        await mergeMp3s(parts, final);
        parts.forEach((p) => fs.promises.unlink(p).catch(() => {}));
      }

      await sock.sendMessage(ctx.from, {
        audio: { url: final },
        mimetype: 'audio/mpeg',
        ptt: true,
      }, { quoted: m });

      await ctx.react('✅');

      // Schedule cleanup
      setTimeout(() => fs.promises.unlink(final).catch(() => {}), TEMP_TTL_MS);
    } catch (err) {
      // Clean up any partial chunks
      parts.forEach((p) => fs.promises.unlink(p).catch(() => {}));
      throw err;       // let commandRunner do the user-facing error reply
    }
  },
};
