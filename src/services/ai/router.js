/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * shouldRespond(ctx) — decides whether the AI service should answer
 * a particular incoming message.
 *
 * Rules (in order, first match wins):
 *   1. config.ai.enabled === false                                     -> { respond: false, reason: 'disabled' }
 *   2. message text is empty / starts with bot prefix or admin prefix  -> false
 *   3. per-chat opt-in row says enabled=false                          -> false (unless DM in 'on' default)
 *   4. per-chat opt-in row says enabled=true                           -> true
 *   5. config.ai.optInDefault === 'on'                                 -> true
 *   6. message mentions bot name (config.ai.botNameRegex)              -> true
 *   7. otherwise                                                       -> false
 *
 * AFTER the decision is "respond", we apply rate limits and a daily
 * cost cap. If either trips, we return { respond: false, reason: '…' }
 * so the caller can decide whether to silently drop or reply with an
 * apology.
 *
 *  Rate limits are kept in-memory (Maps with periodic prune). Restart
 *  resets them — that's acceptable for v1.2.0; persistence is a
 *  Group-D follow-up if needed.
 */
const logger = require('../../core/logger').child({ mod: 'ai/router' });
const { config } = require('../../lib/configLoader');
const conv = require('./conversationStore');
const cost = require('./costTracker');
const { getStore } = require('../../store/instance');

// ─── in-memory rate-limit counters ────────────────────────────────
const _userHour = new Map();   // key: `${userJid}|${hourBucket}` -> count
const _chatDay  = new Map();   // key: `${chatJid}|${dayBucket}`  -> count

function _hourBucket(now = Date.now()) { return Math.floor(now / (60 * 60 * 1000)); }
function _dayBucket(now = Date.now())  { return Math.floor(now / (24 * 60 * 60 * 1000)); }

// Prune old keys every 10 min — bound memory.
setInterval(() => {
  const h = _hourBucket();
  const d = _dayBucket();
  for (const k of _userHour.keys()) {
    const hb = Number(k.split('|')[1]);
    if (hb < h - 1) _userHour.delete(k);
  }
  for (const k of _chatDay.keys()) {
    const db = Number(k.split('|')[1]);
    if (db < d - 1) _chatDay.delete(k);
  }
}, 10 * 60 * 1000).unref();

function _bumpUser(jid) {
  const k = `${jid}|${_hourBucket()}`;
  const n = (_userHour.get(k) || 0) + 1;
  _userHour.set(k, n);
  return n;
}
function _peekUser(jid) { return _userHour.get(`${jid}|${_hourBucket()}`) || 0; }
function _bumpChat(jid) {
  const k = `${jid}|${_dayBucket()}`;
  const n = (_chatDay.get(k) || 0) + 1;
  _chatDay.set(k, n);
  return n;
}
function _peekChat(jid) { return _chatDay.get(`${jid}|${_dayBucket()}`) || 0; }

/**
 * @param {object} ctx
 * @param {string} ctx.chatJid          target chat
 * @param {string} ctx.userJid          sender
 * @param {string} ctx.text             message body
 * @param {boolean} [ctx.isDM]
 * @returns {Promise<{respond: boolean, reason?: string, optIn?: object}>}
 */
async function shouldRespond(ctx) {
  const aiCfg = config.ai || {};
  if (!aiCfg.enabled) return { respond: false, reason: 'disabled' };

  const text = String(ctx.text || '').trim();
  if (!text) return { respond: false, reason: 'empty' };

  const userPrefix  = (typeof config.bot?.prefix      === 'string') ? config.bot.prefix      : '.';
  const adminPrefix = (typeof config.bot?.adminPrefix === 'string') ? config.bot.adminPrefix : '$';
  if (text.startsWith(userPrefix) || text.startsWith(adminPrefix)) {
    return { respond: false, reason: 'is_command' };
  }

  // per-chat opt-in
  let optIn = null;
  try {
    const store = getStore();
    if (store && typeof store.getAiChatOptIn === 'function') {
      optIn = await store.getAiChatOptIn(ctx.chatJid);
    }
  } catch (e) { logger.warn({ err: e }, 'getAiChatOptIn failed'); }

  let decided = false;
  if (optIn && typeof optIn.enabled === 'boolean') {
    decided = optIn.enabled;
  } else if (aiCfg.optInDefault === 'on') {
    decided = true;
  }

  // bot-name mention always wins as an opt-in trigger
  if (!decided) {
    try {
      const re = new RegExp(aiCfg.botNameRegex || 'echofox|bot|@assistant', 'i');
      if (re.test(text)) decided = true;
    } catch (e) {
      logger.warn({ err: e, regex: aiCfg.botNameRegex }, 'bad botNameRegex (ignoring)');
    }
  }

  if (!decided) return { respond: false, reason: 'not_opted_in' };

  // rate limits ─────────────────────────────────────────────────
  const perUser = Number(aiCfg.rateLimitPerUserPerHour || 0);
  const perChat = Number(aiCfg.rateLimitPerChatPerDay  || 0);

  if (perUser > 0 && _peekUser(ctx.userJid) >= perUser) {
    return { respond: false, reason: 'rate_limit_user', optIn };
  }
  if (perChat > 0 && _peekChat(ctx.chatJid) >= perChat) {
    return { respond: false, reason: 'rate_limit_chat', optIn };
  }

  // cost cap ────────────────────────────────────────────────────
  if (await cost.isOverCap()) {
    return { respond: false, reason: 'cost_cap', optIn };
  }

  return { respond: true, optIn };
}

/** Call AFTER a successful response is sent — bumps rate counters. */
function noteSent({ chatJid, userJid }) {
  if (userJid) _bumpUser(userJid);
  if (chatJid) _bumpChat(chatJid);
}

function _resetForTests() {
  _userHour.clear();
  _chatDay.clear();
}

module.exports = { shouldRespond, noteSent, _resetForTests, conv };
