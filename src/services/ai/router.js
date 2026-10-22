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
 *   3. per-chat opt-in row says enabled=false                          -> false (including mentions and DMs)
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
 * Paid requests use store-backed, serialized quota and budget admission.
 * The older noteSent/peek API remains for compatibility, not admission.
 */
const logger = require('../../core/logger').child({ mod: 'ai/router' });
const { config } = require('../../lib/configLoader');
const conv = require('./conversationStore');
const metrics = require('../metrics');
const cost = require('./costTracker');
const { getStore } = require('../../store/instance');

// ─── rate-limit counters: store-backed (v1.3.0+) with in-memory fallback ──
// If the active store lacks AI rate methods we transparently fall back
// to the v1.2.0 in-memory Maps so the bot still works.
const _userHour = new Map(); // key: `${userJid}|${hourBucket}` -> count
const _chatDay = new Map(); // key: `${chatJid}|${dayBucket}`  -> count

function _hourBucket(now = Date.now()) {
  return Math.floor(now / (60 * 60 * 1000));
}
function _dayBucket(now = Date.now()) {
  return Math.floor(now / (24 * 60 * 60 * 1000));
}

// Periodic prune for the in-memory fallback path AND a defensive prune on
// the persistent store (sqlite/postgres only — mongo TTL + redis EXPIRE
// handle themselves). 10-minute cadence.
const _pruneTimer = setInterval(
  () => {
    // in-memory prune
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
    // store prune (best-effort)
    try {
      const store = getStore();
      if (store && typeof store.pruneAiRate === 'function') {
        Promise.resolve(store.pruneAiRate()).catch(() => {});
      }
    } catch (_) {
      /* getStore throws before lifecycle.selectStore — fine */
    }
  },
  10 * 60 * 1000,
);
if (typeof _pruneTimer.unref === 'function') _pruneTimer.unref();

async function _peekUserStore(jid) {
  try {
    const store = getStore();
    if (store && typeof store.getAiRateUser === 'function') {
      return await store.getAiRateUser(jid, _hourBucket());
    }
  } catch (_) {
    /* fall through to memory */
  }
  return _userHour.get(`${jid}|${_hourBucket()}`) || 0;
}
async function _peekChatStore(jid) {
  try {
    const store = getStore();
    if (store && typeof store.getAiRateChat === 'function') {
      return await store.getAiRateChat(jid, _dayBucket());
    }
  } catch (_) {
    /* fall through to memory */
  }
  return _chatDay.get(`${jid}|${_dayBucket()}`) || 0;
}
async function _bumpUserStore(jid) {
  try {
    const store = getStore();
    if (store && typeof store.incrAiRateUser === 'function') {
      return await store.incrAiRateUser(jid, _hourBucket());
    }
  } catch (_) {
    /* fall through */
  }
  const k = `${jid}|${_hourBucket()}`;
  const n = (_userHour.get(k) || 0) + 1;
  _userHour.set(k, n);
  return n;
}
async function _bumpChatStore(jid) {
  try {
    const store = getStore();
    if (store && typeof store.incrAiRateChat === 'function') {
      return await store.incrAiRateChat(jid, _dayBucket());
    }
  } catch (_) {
    /* fall through */
  }
  const k = `${jid}|${_dayBucket()}`;
  const n = (_chatDay.get(k) || 0) + 1;
  _chatDay.set(k, n);
  return n;
}

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
  if (!config.bot.public && ctx.isAdmin !== true) return { respond: false, reason: 'private_mode' };

  const text = String(ctx.text || '').trim();
  if (!text) return { respond: false, reason: 'empty' };

  const userPrefix = typeof config.bot?.prefix === 'string' ? config.bot.prefix : '.';
  const adminPrefix = typeof config.bot?.adminPrefix === 'string' ? config.bot.adminPrefix : '$';
  if (text.startsWith(userPrefix) || text.startsWith(adminPrefix)) {
    return { respond: false, reason: 'is_command' };
  }

  let optIn;
  try {
    optIn = await authorizeRequest(ctx);
  } catch (error) {
    return { respond: false, reason: error.reason || 'policy_unavailable' };
  }

  let decided = false;
  if (optIn && typeof optIn.enabled === 'boolean') {
    decided = optIn.enabled;
  } else if (aiCfg.optInDefault === 'on') {
    decided = true;
  }

  // A mention can activate an unset preference, but NEVER override an explicit opt-out.
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
  const perChat = Number(aiCfg.rateLimitPerChatPerDay || 0);

  if (perUser > 0 && (await _peekUserStore(ctx.userJid)) >= perUser) {
    metrics.incAiRateLimit();
    return { respond: false, reason: 'rate_limit_user', optIn };
  }
  if (perChat > 0 && (await _peekChatStore(ctx.chatJid)) >= perChat) {
    metrics.incAiRateLimit();
    return { respond: false, reason: 'rate_limit_chat', optIn };
  }

  // cost cap ────────────────────────────────────────────────────
  if (await cost.isOverCap()) {
    metrics.incAiCostCapHit();
    return { respond: false, reason: 'cost_cap', optIn };
  }

  return { respond: true, optIn };
}

/**
 * Call AFTER a successful response is sent — bumps rate counters.
 * Returns a promise but callers may ignore it (fire-and-forget is fine).
 */
async function noteSent({ chatJid, userJid }) {
  if (userJid) {
    try {
      await _bumpUserStore(userJid);
    } catch (_) {
      /* ignore */
    }
  }
  if (chatJid) {
    try {
      await _bumpChatStore(chatJid);
    } catch (_) {
      /* ignore */
    }
  }
}

const denied = (reason) => {
  const expected = [
    'disabled',
    'private_mode',
    'chat_excluded',
    'opted_out',
    'rate_limit_user',
    'rate_limit_chat',
  ];
  const ErrorType = expected.includes(reason) ? require('../../lib/errors').UserError : Error;
  return Object.assign(new ErrorType(`AI request denied: ${reason}`), {
    code: 'EAI_POLICY',
    reason,
  });
};

async function authorizeRequest(ctx) {
  if (!config.ai?.enabled) throw denied('disabled');
  if (!ctx.chatJid || !ctx.userJid) throw denied('missing_caller_context');
  if (!config.bot.public && ctx.isAdmin !== true) throw denied('private_mode');
  if (require('../../lib/privacyPolicy').isExcluded(ctx.chatJid)) throw denied('chat_excluded');
  let preference;
  try {
    const store = getStore();
    if (typeof store?.getAiChatOptIn !== 'function') throw denied('policy_unavailable');
    preference = await store.getAiChatOptIn(ctx.chatJid);
  } catch {
    throw denied('policy_unavailable');
  }
  if (preference?.enabled === false) throw denied('opted_out');
  return preference;
}

let admission = Promise.resolve();
/** All paid entry points share this admission gate. Quotas count admitted
 * attempts, including provider failures. Admission is atomic in ONE process;
 * independent replicas still require a distributed transactional gate.
 */
function admitRequest(ctx, estimatedUsd) {
  const result = admission.then(async () => {
    await authorizeRequest(ctx);
    const store = getStore();
    const limits = [
      [
        Number(config.ai.rateLimitPerUserPerHour),
        'getAiRateUser',
        'incrAiRateUser',
        ctx.userJid,
        _hourBucket(),
        'rate_limit_user',
      ],
      [
        Number(config.ai.rateLimitPerChatPerDay),
        'getAiRateChat',
        'incrAiRateChat',
        ctx.chatJid,
        _dayBucket(),
        'rate_limit_chat',
      ],
    ];
    for (const [limit, read, increment, jid, bucket, reason] of limits) {
      if (limit <= 0) continue;
      if (typeof store[read] !== 'function' || typeof store[increment] !== 'function')
        throw denied('quota_unavailable');
      const used = await store[read](jid, bucket);
      if (!Number.isFinite(used) || used < 0) throw denied('quota_unavailable');
      if (used >= limit) throw denied(reason);
    }
    const reservationId = await cost.admit(estimatedUsd);
    try {
      for (const [limit, , increment, jid, bucket] of limits) {
        if (limit <= 0) continue;
        const count = await store[increment](jid, bucket);
        if (!Number.isFinite(count) || count < 1) throw denied('quota_unavailable');
      }
      return reservationId;
    } catch (error) {
      cost.release(reservationId);
      throw error;
    }
  });
  admission = result.catch(() => {});
  return result;
}

function _resetForTests() {
  admission = Promise.resolve();
  _userHour.clear();
  _chatDay.clear();
}

module.exports = { shouldRespond, authorizeRequest, admitRequest, noteSent, _resetForTests, conv };
