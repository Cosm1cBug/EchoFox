/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Telegram raw-HTTPS transport (v1.3.0).
 *
 * No SDK — Bot API is a simple JSON-over-HTTPS protocol. Calls go via
 * axiosWithBreaker so 502/timeout cascades open a circuit and stop
 * stampeding api.telegram.org.
 *
 *   sendMessage({ chatId, text, parseMode })
 *     -> { ok: boolean, status?: number, error?: string,
 *          retryAfter?: number, messageId?: number }
 *
 * HTML escape + chunking helpers are exported for the routing layer.
 */
const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');
const { config } = require('../../lib/configLoader');

let _override = null;

function __testOverride(fn) { _override = fn; }
function _resetForTests()    { _override = null; }

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Telegram MarkdownV2 escape — used only if parseMode === 'MarkdownV2'.
 * Per https://core.telegram.org/bots/api#markdownv2-style.
 */
function escapeMarkdownV2(s) {
  return String(s == null ? '' : s).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Split a body into chunks that stay within Telegram's 4096-char limit
 * (we default to maxChunkChars from config, headroom for code fences etc.).
 * Tries to split on newline; falls back to hard cut.
 */
function chunkText(body, maxChars) {
  const limit = Math.max(500, Math.min(4096, Number(maxChars) || 3800));
  const s = String(body == null ? '' : body);
  if (s.length <= limit) return [s];
  const out = [];
  let i = 0;
  while (i < s.length) {
    let end = Math.min(i + limit, s.length);
    if (end < s.length) {
      const nl = s.lastIndexOf('\n', end);
      if (nl > i + Math.floor(limit / 2)) end = nl;
    }
    out.push(s.slice(i, end));
    i = end;
    while (s[i] === '\n') i += 1;
  }
  return out;
}

async function sendMessage({ chatId, text, parseMode = 'HTML' }) {
  const token = config.telegram?.botToken;
  if (!token) return { ok: false, error: 'no_bot_token' };
  if (!chatId) return { ok: false, error: 'no_chat_id' };

  // Test override short-circuits the network call entirely.
  if (_override) return _override({ chatId, text, parseMode });

  const ax = axiosWithBreaker('telegram-send', { timeout: 10_000 });
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (parseMode === 'HTML')        payload.parse_mode = 'HTML';
  else if (parseMode === 'MarkdownV2') payload.parse_mode = 'MarkdownV2';
  // 'plain' => no parse_mode

  try {
    const r = await ax.post(url, payload);
    return { ok: true, status: r.status, messageId: r.data?.result?.message_id };
  } catch (e) {
    if (isOpenBreakerError(e)) return { ok: false, error: 'circuit_open' };
    const status = e.response?.status;
    const retryAfter = Number(e.response?.data?.parameters?.retry_after || 0) || undefined;
    return {
      ok: false,
      status,
      error: e.response?.data?.description || e.code || e.message,
      retryAfter,
    };
  }
}

module.exports = {
  sendMessage,
  escapeHtml,
  escapeMarkdownV2,
  chunkText,
  __testOverride,
  _resetForTests,
};
