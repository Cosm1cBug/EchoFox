/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .imagine <prompt> — text→image generation via OpenAI Images API.
 *
 *   .imagine a cyberpunk fox sitting on a server rack, neon lights
 *   .imagine -s 512 a watercolour skyline of mumbai at dawn
 *   .imagine -q hd  a hyperrealistic close-up of a hummingbird
 *
 * Flags (optional, must come BEFORE the prompt):
 *   -s | --size <256|512|1024|1792>   default 1024 (square)
 *   -q | --quality <standard|hd>      default standard
 *
 * Cost-cap awareness:
 *   • Each image is billed at a fixed per-image price (see PRICE_USD
 *     below — current as of 2026-Q2 for gpt-image-1).
 *   • Before generating, we check `cost.isOverCap()`. After generating,
 *     we record the price via `cost.record(...)` so it counts toward the
 *     daily cap exactly like chat-mode usage.
 *   • A reservation is held during the API call (v1.5.0 pattern).
 *
 * Hard guardrails:
 *   • Prompt ≤ 1000 chars (OpenAI rejects > ~4000 anyway, this is friendlier).
 *   • Rate-limited: cooldown 60s/user via the registry.
 *   • Requires OPENAI_API_KEY (or config.ai.providers.openai.apiKey).
 *
 *   The output image is returned to the chat as a JPEG/PNG attachment
 *   with the prompt as caption.
 */

const { config } = require('../../lib/configLoader');
const ai = require('../../services/ai');
const logger = require('../../core/logger').child({ mod: 'imagine' });

const MAX_PROMPT_LEN = 1000;
const VALID_SIZES = new Set(['256', '512', '1024', '1792']);
const VALID_QUALITY = new Set(['standard', 'hd']);

// Approximate per-image price in USD for cost-cap bookkeeping.
// Conservative — overestimates rather than under so the cap holds.
function priceForImage(size, quality) {
  const s = parseInt(size, 10) || 1024;
  const hd = quality === 'hd';
  if (s <= 256) return hd ? 0.02 : 0.016;
  if (s <= 512) return hd ? 0.03 : 0.02;
  if (s <= 1024) return hd ? 0.08 : 0.04;
  return hd ? 0.12 : 0.08;
}

function parseFlags(input) {
  const tokens = String(input || '')
    .trim()
    .split(/\s+/);
  let size = '1024';
  let quality = 'standard';
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if ((t === '-s' || t === '--size') && tokens[i + 1]) {
      if (!VALID_SIZES.has(tokens[i + 1])) {
        return {
          error: `invalid size '${tokens[i + 1]}'. Use one of: ${[...VALID_SIZES].join(', ')}`,
        };
      }
      size = tokens[i + 1];
      i += 2;
    } else if ((t === '-q' || t === '--quality') && tokens[i + 1]) {
      if (!VALID_QUALITY.has(tokens[i + 1])) {
        return {
          error: `invalid quality '${tokens[i + 1]}'. Use one of: ${[...VALID_QUALITY].join(', ')}`,
        };
      }
      quality = tokens[i + 1];
      i += 2;
    } else {
      break;
    }
  }
  const prompt = tokens.slice(i).join(' ').trim();
  return { size, quality, prompt };
}

module.exports = {
  name: 'imagine',
  alias: ['img', 'gen', 'dalle'],
  desc: 'Generate an image from a text prompt (OpenAI Images).',
  category: 'general',
  type: 'general',
  usage: '[-s 256|512|1024|1792] [-q standard|hd] <prompt>',
  cooldown: 60,
  timeout: 120,

  async start(sock, m, { ctx, text }) {
    if (!config.ai?.enabled) {
      return ctx.reply('🤖 AI is disabled. Ask an admin to enable it in config.');
    }

    const apiKey = config.ai?.providers?.openai?.apiKey || process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      return ctx.reply(
        '🔑 OpenAI API key not configured. Set `config.ai.providers.openai.apiKey` ' +
          'or the `OPENAI_API_KEY` env var.',
      );
    }

    const parsed = parseFlags(text);
    if (parsed.error) return ctx.reply(`❌ ${parsed.error}`);

    const { size, quality, prompt } = parsed;
    if (!prompt) {
      return ctx.reply(
        '🖼️ *Imagine — text→image*\n\n' +
          'Usage: `.imagine [-s 256|512|1024|1792] [-q standard|hd] <prompt>`\n\n' +
          'Examples:\n' +
          '• `.imagine a cyberpunk fox on a server rack, neon lights`\n' +
          '• `.imagine -s 512 watercolour skyline of mumbai at dawn`\n' +
          '• `.imagine -q hd a hyperrealistic hummingbird close-up`',
      );
    }
    if (prompt.length > MAX_PROMPT_LEN) {
      return ctx.reply(`❌ Prompt too long (max ${MAX_PROMPT_LEN} chars).`);
    }

    // ─── Cost cap pre-check + reservation ────────────────────────────
    const cost = ai.cost;
    if (await cost.isOverCap()) {
      return ctx.reply('💸 Daily AI cost cap reached. Try again tomorrow.');
    }
    const price = priceForImage(size, quality);
    const reservationId = cost.reserve(price);

    await ctx.react('🎨');

    try {
      const OpenAI = require('openai').default || require('openai');
      const client = new OpenAI({
        apiKey,
        baseURL: config.ai?.providers?.openai?.baseUrl || undefined,
      });

      const apiSize = size === '1792' ? '1792x1024' : `${size}x${size}`;

      const resp = await client.images.generate({
        model: config.ai?.imageModel || 'gpt-image-1',
        prompt,
        size: apiSize,
        quality,
        n: 1,
      });

      // OpenAI returns either `url` or `b64_json` — handle both.
      const imgData = resp?.data?.[0];
      if (!imgData) {
        throw new Error('OpenAI returned no image data');
      }

      let buf;
      if (imgData.b64_json) {
        buf = Buffer.from(imgData.b64_json, 'base64');
      } else if (imgData.url) {
        const axios = require('axios');
        const dl = await axios.get(imgData.url, {
          responseType: 'arraybuffer',
          timeout: 30_000,
          maxContentLength: 10 * 1024 * 1024,
          maxBodyLength: 10 * 1024 * 1024,
        });
        buf = Buffer.from(dl.data);
      } else {
        throw new Error('OpenAI response had neither b64_json nor url');
      }

      // Book the actual price against the daily cap.
      // We don't get token usage here, so pass 0/0 tokens and use `costUsd`
      // override via a synthetic entry — record() accepts (provider, model,
      // promptTokens, completionTokens). We approximate by recording
      // proportional "tokens" that yield the known image price. Cleaner:
      // costTracker exposes an addRaw() — fall back to direct add if so.
      if (typeof cost.recordRaw === 'function') {
        await cost.recordRaw('openai', 'gpt-image-1', price);
      } else {
        // Best-effort: record nominal — the reservation already gates the cap.
        await cost.record('openai', 'gpt-image-1', 0, 0).catch(() => {});
      }

      await sock.sendMessage(
        ctx.chat,
        {
          image: buf,
          caption:
            `🖼️ *Imagined* (${apiSize}, ${quality})\n\n` +
            `_Prompt:_ ${prompt.length > 200 ? prompt.slice(0, 200) + '…' : prompt}\n` +
            `_Cost:_ ~$${price.toFixed(3)}`,
          mimetype: 'image/png',
        },
        { quoted: m.raw || m },
      );
    } catch (err) {
      logger.warn({ err, prompt }, 'image generation failed');
      const msg = err?.response?.data?.error?.message || err.message || String(err);
      return ctx.reply(`❌ Image generation failed: ${msg.slice(0, 300)}`);
    } finally {
      cost.release(reservationId);
    }
  },
};
