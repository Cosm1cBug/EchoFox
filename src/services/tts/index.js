/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Text-to-Speech provider facade (v1.1.1).
 *
 *   synthesize(text, { lang?, voice? }) → Promise<Buffer>
 *
 *   Routes to the configured provider:
 *     • edge   — msedge-tts (default; neural voices, free, no setup)
 *     • google — google-tts-api + axios (basic gTTS, URL-based)
 *     • piper  — subprocess to local 'piper' binary (offline, high quality)
 *     • coqui  — subprocess to local Python TTS (offline, best quality)
 *
 *   All providers return MP3 audio as a Buffer. Callers do NOT need
 *   to know which provider is active.
 *
 *   Config: see config.tts.* in config.example.js.
 */

const { config } = require('../../lib/configLoader');
const logger = require('../../core/logger').child({ mod: 'tts' });

const PROVIDERS = {
  edge:   () => require('./providers/edge'),
  google: () => require('./providers/google'),
  piper:  () => require('./providers/piper'),
  coqui:  () => require('./providers/coqui'),
};

function getProvider(name) {
  const ctor = PROVIDERS[name];
  if (!ctor) throw new Error(`Unknown TTS provider: ${name}`);
  return ctor();
}

/**
 * Synthesize speech from text.
 *
 * @param {string} text       — input text (will be capped at config.tts.maxChars)
 * @param {object} [opts]
 * @param {string} [opts.lang]   — 2-letter ISO language code (default config.tts.defaultLang)
 * @param {string} [opts.voice]  — provider-specific voice ID (default config.tts.defaultVoice)
 * @param {string} [opts.provider] — override the configured provider for this call
 * @returns {Promise<Buffer>}    — MP3 audio buffer
 */
async function synthesize(text, opts = {}) {
  if (!text || typeof text !== 'string') throw new Error('TTS: text required');

  const maxChars = config.tts?.maxChars ?? 8000;
  if (text.length > maxChars) {
    throw new Error(`TTS: text too long (${text.length} chars, max ${maxChars})`);
  }

  const providerName = opts.provider || config.tts?.provider || 'edge';
  const lang = opts.lang || config.tts?.defaultLang || 'en';
  const voice = opts.voice || config.tts?.defaultVoice;

  const provider = getProvider(providerName);
  logger.debug({ provider: providerName, lang, voice, chars: text.length }, 'TTS synthesize');

  const start = Date.now();
  const buf = await provider.synthesize(text, { lang, voice });
  logger.debug({ provider: providerName, ms: Date.now() - start, bytes: buf.length }, 'TTS done');
  return buf;
}

/**
 * List available voices/languages for the active provider (best-effort).
 * Returns { voices: [...], languages: [...] } or { error: '...' }.
 */
async function listVoices(opts = {}) {
  const providerName = opts.provider || config.tts?.provider || 'edge';
  const provider = getProvider(providerName);
  if (typeof provider.listVoices === 'function') {
    return provider.listVoices();
  }
  return { error: `provider ${providerName} does not support voice listing` };
}

module.exports = { synthesize, listVoices };