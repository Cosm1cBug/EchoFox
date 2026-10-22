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
 *     below — fixed-price DALL-E models; operator must verify current rates).
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
const { isConfiguredAdmin } = require('../../lib/jidResolve');
const { getStore } = require('../../store/instance');
const { publicGet } = require('../../lib/network');

const MAX_PROMPT_LEN = 1000;
const VALID_SIZES = new Set(['256', '512', '1024', '1792']);
const VALID_QUALITY = new Set(['standard', 'hd']);

// Approximate per-image price in USD for cost-cap bookkeeping.
// Conservative — overestimates rather than under so the cap holds.
function priceForImage(model, size, quality) {
  if (!['dall-e-2', 'dall-e-3'].includes(model))
    throw new Error('Image model has no fixed-price policy; configure dall-e-2 or dall-e-3');
  if (model === 'dall-e-3' && !['1024', '1792'].includes(size))
    throw new Error('dall-e-3 requires size 1024 or 1792');
  if (model === 'dall-e-2' && (size === '1792' || quality !== 'standard'))
    throw new Error('dall-e-2 requires standard quality and size 256, 512 or 1024');
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

    const cost = ai.cost;
    const model = config.ai.imageModel;
    const price = priceForImage(model, size, quality);
    const reservationId = await ai.router.admitRequest(
      {
        chatJid: ctx.chat,
        userJid: ctx.sender,
        isAdmin: await isConfiguredAdmin(sock, getStore(), ctx.sender, config.admins, ctx.senderPn),
      },
      price,
    );
    let attempted = false;
    let accounted = false;
    try {
      await ctx.react('🎨');
      const OpenAI = require('openai').default || require('openai');
      const client = new OpenAI({
        apiKey,
        baseURL: config.ai?.providers?.openai?.baseUrl || undefined,
      });

      const apiSize = size === '1792' ? '1792x1024' : `${size}x${size}`;

      attempted = true;
      const resp = await client.images.generate({
        model,
        prompt,
        size: apiSize,
        quality,
        n: 1,
      });

      await cost.recordRaw('openai', model, price);
      accounted = true;

      // OpenAI returns either `url` or `b64_json` — handle both.
      const imgData = resp?.data?.[0];
      if (!imgData) {
        throw new Error('OpenAI returned no image data');
      }

      let buf;
      if (imgData.b64_json) {
        buf = Buffer.from(imgData.b64_json, 'base64');
      } else if (imgData.url) {
        const dl = await publicGet('ai-image-download', imgData.url, {
          responseType: 'arraybuffer',
          timeout: 30_000,
          maxContentLength: 10 * 1024 * 1024,
          maxBodyLength: 10 * 1024 * 1024,
        });
        buf = Buffer.from(dl.data);
      } else {
        throw new Error('OpenAI response had neither b64_json nor url');
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
      logger.warn({ code: 'IMAGE_REQUEST_FAILED' }, 'image generation failed');
      return ctx.reply('❌ Image generation failed. Please try again shortly.');
    } finally {
      try {
        if (attempted && !accounted)
          await cost.recordRaw('openai', `${model}:unconfirmed-estimate`, price);
      } finally {
        cost.release(reservationId);
      }
    }
  },
};
