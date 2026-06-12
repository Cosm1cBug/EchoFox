/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Telegram log-bridge facade (v1.3.0).
 *
 * Outbound-only. The bot never polls Telegram for incoming messages.
 *
 *   forward(channelKey, payload)
 *     channelKey: 'syslogs' | 'botLogs' | 'userLogs' | 'groupUpdates'
 *                 | 'callLogs' | 'errLogs' | 'movGroup'
 *     payload:   { text: string, level?: 'debug'|'info'|'warn'|'error'|'fatal',
 *                  source?: string, ts?: number }
 *
 *   Behaviour:
 *     - if config.telegram.enabled === false OR routing missing -> drop silently
 *     - non-error levels: buffer up to config.telegram.batchMs (default 2s)
 *       then flush as a single message (multiple lines joined with \\n)
 *     - error/fatal levels: flush immediately on push (interrupts batch)
 *     - flushed payload renders with optional HTML tag + level emoji
 *     - chunks at maxChunkChars (Telegram cap is 4096)
 *
 *   flushAll() — utility for shutdown / tests
 *   _resetForTests() — clear all buffers + timers
 */
const logger = require('../../core/logger').child({ mod: 'telegram' });
const { config } = require('../../lib/configLoader');
const routing = require('./routing');
const transport = require('./transport');

const _buffers = new Map();    // channelKey -> [{ text, level, source, ts }]
const _timers  = new Map();    // channelKey -> Timeout

const LEVEL_ICON = Object.freeze({
  fatal: '💀',
  error: '❌',
  warn:  '⚠️',
  info:  'ℹ️',
  debug: '🐛',
});

function _renderEntry({ text, level, source, ts }, parseMode) {
  const t = new Date(Number(ts || Date.now())).toISOString().replace('T', ' ').replace('Z', '');
  const icon = LEVEL_ICON[level] || '•';
  const lvl  = String(level || 'info').toUpperCase();
  const src  = source ? `[${source}]` : '';

  if (parseMode === 'HTML') {
    return `${icon} <b>${transport.escapeHtml(lvl)}</b> <code>${transport.escapeHtml(t)}</code> ${transport.escapeHtml(src)}\n${transport.escapeHtml(text)}`;
  }
  if (parseMode === 'MarkdownV2') {
    return `${icon} *${transport.escapeMarkdownV2(lvl)}* \`${transport.escapeMarkdownV2(t)}\` ${transport.escapeMarkdownV2(src)}\n${transport.escapeMarkdownV2(text)}`;
  }
  // plain
  return `${icon} ${lvl} ${t} ${src}\n${text}`;
}

async function _flushChannel(channelKey) {
  const buf = _buffers.get(channelKey);
  if (!buf || !buf.length) return;
  _buffers.set(channelKey, []);
  const timer = _timers.get(channelKey);
  if (timer) { clearTimeout(timer); _timers.delete(channelKey); }

  const chatId = routing.resolve(channelKey);
  if (!chatId) return;

  const parseMode = config.telegram?.parseMode || 'HTML';
  const sep = parseMode === 'plain' ? '\n\n' : '\n\n';
  const body = buf.map((e) => _renderEntry(e, parseMode)).join(sep);
  const chunks = transport.chunkText(body, config.telegram?.maxChunkChars || 3800);

  for (const text of chunks) {
    const r = await transport.sendMessage({ chatId, text, parseMode });
    if (!r.ok) {
      // Retry once after Telegram's suggested back-off, otherwise drop silently.
      if (r.retryAfter && r.retryAfter > 0 && r.retryAfter < 60) {
        await new Promise((res) => setTimeout(res, r.retryAfter * 1000));
        const r2 = await transport.sendMessage({ chatId, text, parseMode });
        if (!r2.ok) logger.warn({ channelKey, err: r2.error }, 'telegram: send failed after retry');
      } else {
        logger.warn({ channelKey, err: r.error, status: r.status }, 'telegram: send failed');
      }
    }
  }
}

function _ensureBuf(channelKey) {
  if (!_buffers.has(channelKey)) _buffers.set(channelKey, []);
  return _buffers.get(channelKey);
}

function _scheduleFlush(channelKey) {
  if (_timers.has(channelKey)) return;
  const ms = Math.max(0, Number(config.telegram?.batchMs) || 0);
  if (ms === 0) {
    // immediate mode — flush on next tick to coalesce same-tick pushes
    setImmediate(() => _flushChannel(channelKey).catch((e) => logger.warn({ err: e }, 'flush failed')));
    return;
  }
  const t = setTimeout(() => {
    _flushChannel(channelKey).catch((e) => logger.warn({ err: e }, 'flush failed'));
  }, ms);
  if (typeof t.unref === 'function') t.unref();
  _timers.set(channelKey, t);
}

/**
 * Public entry point. Safe to call when telegram is disabled — returns false.
 *
 * @returns {boolean} false if dropped (disabled / not routed), true if queued.
 */
function forward(channelKey, payload) {
  try {
    if (!config.telegram?.enabled) return false;
    if (!routing.resolve(channelKey)) return false;
    const entry = {
      text:   String(payload?.text || ''),
      level:  String(payload?.level || 'info').toLowerCase(),
      source: payload?.source ? String(payload.source) : '',
      ts:     Number(payload?.ts) || Date.now(),
    };
    _ensureBuf(channelKey).push(entry);
    if (entry.level === 'error' || entry.level === 'fatal') {
      // Immediate flush — clear any pending timer first.
      const t = _timers.get(channelKey);
      if (t) { clearTimeout(t); _timers.delete(channelKey); }
      setImmediate(() => _flushChannel(channelKey).catch((e) =>
        logger.warn({ err: e }, 'urgent flush failed')));
    } else {
      _scheduleFlush(channelKey);
    }
    return true;
  } catch (e) {
    logger.warn({ err: e, channelKey }, 'forward failed');
    return false;
  }
}

async function flushAll() {
  for (const key of [..._buffers.keys()]) {
    try { await _flushChannel(key); }
    catch (e) { logger.warn({ err: e, key }, 'flushAll failed for channel'); }
  }
}

function _resetForTests() {
  for (const t of _timers.values()) clearTimeout(t);
  _timers.clear();
  _buffers.clear();
}

module.exports = {
  forward,
  flushAll,
  routing,
  transport,
  _resetForTests,
  _renderEntry,   // exported for tests
};
