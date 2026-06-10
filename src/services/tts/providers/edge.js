/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Edge TTS provider — Microsoft Edge's free neural-voice TTS endpoint
 * via WebSocket. Best free quality available, no setup, no API key.
 *
 * The msedge-tts library handles the WebSocket handshake + signed
 * authentication tokens. We just feed it text + voice + format.
 *
 * Voice naming convention: '<locale>-<name>Neural'
 *   • en-US-AriaNeural (default — clear, friendly female US)
 *   • en-US-GuyNeural (male US)
 *   • en-GB-RyanNeural (male UK)
 *   • hi-IN-SwaraNeural (Hindi female)
 *   • es-ES-ElviraNeural (Spanish female)
 *   • Full list: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support
 *
 * If a 2-letter `lang` is passed without a voice, we pick a sensible
 * default for that language.
 */

const { config } = require('../../../lib/configLoader');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Sensible voice defaults per 2-letter ISO language code.
const VOICE_BY_LANG = {
  en: 'en-US-AriaNeural',
  hi: 'hi-IN-SwaraNeural',
  es: 'es-ES-ElviraNeural',
  fr: 'fr-FR-DeniseNeural',
  de: 'de-DE-KatjaNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
  pt: 'pt-BR-FranciscaNeural',
  it: 'it-IT-ElsaNeural',
  ru: 'ru-RU-SvetlanaNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
  ar: 'ar-SA-ZariyahNeural',
  nl: 'nl-NL-ColetteNeural',
  pl: 'pl-PL-AgnieszkaNeural',
  tr: 'tr-TR-EmelNeural',
  vi: 'vi-VN-HoaiMyNeural',
  th: 'th-TH-PremwadeeNeural',
  id: 'id-ID-GadisNeural',
  ml: 'ml-IN-SobhanaNeural',
  ta: 'ta-IN-PallaviNeural',
  te: 'te-IN-ShrutiNeural',
  bn: 'bn-IN-TanishaaNeural',
  ur: 'ur-PK-UzmaNeural',
};

function pickVoice(lang, explicitVoice) {
  if (explicitVoice) return explicitVoice;
  if (lang && VOICE_BY_LANG[lang.toLowerCase()]) return VOICE_BY_LANG[lang.toLowerCase()];
  return config.tts?.defaultVoice || 'en-US-AriaNeural';
}

function parseFormat(formatStr) {
  // Convert config string like 'audio-24khz-48kbitrate-mono-mp3' to OUTPUT_FORMAT enum.
  // The enum key is uppercase+underscore form: 'AUDIO_24KHZ_48KBITRATE_MONO_MP3'.
  const key = (formatStr || 'audio-24khz-48kbitrate-mono-mp3')
    .toUpperCase()
    .replace(/-/g, '_');
  return OUTPUT_FORMAT[key] || OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
}

async function synthesize(text, opts = {}) {
  const voice = pickVoice(opts.lang, opts.voice);
  const format = parseFormat(config.tts?.edge?.outputFormat);

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, format);

  const { audioStream } = await tts.toStream(text);

  const chunks = [];
  return new Promise((resolve, reject) => {
    audioStream.on('data', (c) => chunks.push(c));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
    // Safety: timeout after 60s
    setTimeout(() => reject(new Error('Edge TTS timeout (60s)')), 60_000).unref();
  });
}

async function listVoices() {
  const tts = new MsEdgeTTS();
  const voices = await tts.getVoices();
  return {
    voices: voices.map((v) => ({
      name: v.ShortName,
      locale: v.Locale,
      gender: v.Gender,
      friendlyName: v.FriendlyName,
    })),
    defaults: VOICE_BY_LANG,
  };
}

module.exports = { synthesize, listVoices };