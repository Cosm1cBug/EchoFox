/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * levelingService — per-user XP + level tracking, visible only in
 * `.profile` command output (and the v1.16.0 dashboard leaderboard).
 *
 * v1.16.0 extensions:
 *   • Global XP multiplier  (config.leveling.xpMultiplier, default 1.0)
 *   • Optional level-up DM  (per-user opt-in via .notify on)
 *   • XP decay sweep        (separate service: levelingDecayService.js)
 *
 * Storage:
 *   New `user_levels` table (one migration per backend). Schema:
 *     jid     TEXT PRIMARY KEY
 *     xp      INTEGER NOT NULL DEFAULT 0
 *     last_at INTEGER NOT NULL DEFAULT 0   (unix seconds — for decay sweep)
 *
 * XP accrual:
 *   Awarded by the command runner after every successful command via
 *   `awardForCommand(userJid, cmd, sock)`. XP amount varies by category:
 *     general / tools / convert / download / entertainment   →  5 XP
 *     admin / group / user / misc / main                     → 10 XP
 *     AI commands (.ai, .ask, .summarize, .explain, .imagine) → 15 XP
 *
 *   v1.16.0: the categorical XP is multiplied by config.leveling.xpMultiplier
 *   (default 1.0). Set to 2.0 for a global "2x XP weekend", 0.5 to halve, etc.
 *
 *   Cap at 5x to prevent runaway inflation if someone fat-fingers the config.
 *
 * Level curve (Fibonacci-style, growth factor 1.5):
 *   threshold(1) = 100
 *   threshold(N) = threshold(N-1) * 1.5      (integer-rounded)
 *
 *   Example thresholds:
 *     L1→L2 = 100         L5→L6  = 506
 *     L10→L11 = 3,844     L20→L21 = 221,495
 *
 * Display:
 *   `.profile` reads xp via `getLevel(jid)` and renders one line:
 *     *Level:* 7 (1,234 / 1,728 XP — 71%)
 *
 * Privacy:
 *   No per-user comparison outside the user's own .profile.
 *   v1.16.0 adds a global top-10 leaderboard *display name* tab in the
 *   dashboard — but that's bot-operator-only (basic auth required).
 *   No inter-user comparison via chat commands.
 *
 * Safety:
 *   • All DB calls wrapped in try/catch and fail closed.
 *   • Bot's own JID never accrues XP.
 *   • Level-up DM is fire-and-forget; failure never breaks awardForCommand.
 */

const { getStore } = require('../store/instance');
const logger = require('../core/logger').child({ mod: 'leveling' });
const { config } = require('../lib/configLoader');

const BASE_THRESHOLD = 100;
const GROWTH_FACTOR = 1.5;
const MAX_LEVEL_CHECK = 100;
const MAX_XP_MULTIPLIER = 5.0;

// XP per command category. Lookup is by `cmd.category` first, falling
// back to `cmd.type`, then defaulting to 5.
const CATEGORY_XP = {
  general: 5,
  tools: 5,
  convert: 5,
  download: 5,
  entertainment: 5,
  admin: 10,
  group: 10,
  user: 10,
  misc: 10,
  main: 10,
};

// AI commands override category XP regardless of where they live.
const AI_COMMAND_NAMES = new Set(['ai', 'ask', 'summarize', 'explain', 'imagine']);

// v1.16.0 — synthetic "service" key for level-up DM opt-in. Reuses
// the existing service_subscribers row layout (no new migration).
const NOTIFY_SERVICE = 'levelup-notify';

/* ─── pure helpers (no I/O) ────────────────────────────────────── */

/**
 * Return the cumulative XP required to *enter* level `n` (n ≥ 1).
 * Level 1 starts at 0 xp. Level 2 starts at 100 xp. Level 3 starts
 * at 100 + 150 = 250 xp. Level 4 at 100 + 150 + 225 = 475 xp. Etc.
 */
function xpFloorForLevel(n) {
  if (n <= 1) return 0;
  let floor = 0;
  let step = BASE_THRESHOLD;
  for (let i = 2; i <= n; i++) {
    floor += step;
    step = Math.round(step * GROWTH_FACTOR);
  }
  return floor;
}

/**
 * Given total XP, return the user's current level + progress info:
 *   { level, xp, intoLevelXp, neededForNext, percentToNext }
 */
function describe(totalXp) {
  const xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;
  let floor = 0;
  let step = BASE_THRESHOLD;
  while (level < MAX_LEVEL_CHECK && xp >= floor + step) {
    floor += step;
    level += 1;
    step = Math.round(step * GROWTH_FACTOR);
  }
  const intoLevelXp = xp - floor;
  const neededForNext = step;
  const percentToNext = neededForNext > 0 ? Math.min(100, (intoLevelXp / neededForNext) * 100) : 0;
  return {
    level,
    xp,
    intoLevelXp,
    neededForNext,
    percentToNext: Math.round(percentToNext * 10) / 10,
  };
}

/**
 * Compute the level a given XP total maps to (just the integer level).
 */
function levelFor(totalXp) {
  return describe(totalXp).level;
}

function xpForCommand(cmd) {
  if (!cmd) return 0;
  let base;
  if (AI_COMMAND_NAMES.has(cmd.name)) {
    base = 15;
  } else {
    const cat = cmd.category || cmd.type;
    base = cat && Object.prototype.hasOwnProperty.call(CATEGORY_XP, cat) ? CATEGORY_XP[cat] : 5;
  }

  // v1.16.0 — apply global multiplier. Clamped between 0 and MAX_XP_MULTIPLIER
  // to prevent abuse if config is tampered with at runtime. Zod schema enforces
  // this on load too, but belt-and-suspenders for $leveling override.
  const raw = Number(config?.leveling?.xpMultiplier);
  const mult = Number.isFinite(raw) ? Math.max(0, Math.min(MAX_XP_MULTIPLIER, raw)) : 1.0;
  return Math.max(0, Math.floor(base * mult));
}

/* ─── I/O helpers (backend-agnostic via store) ─────────────────── */

async function getLevel(userJid) {
  const store = getStore();
  let xp = 0;
  try {
    if (typeof store.getUserLevel === 'function') {
      const row = await store.getUserLevel(userJid);
      if (row && typeof row.xp === 'number') xp = row.xp;
    }
  } catch (err) {
    logger.debug({ err, userJid }, 'getUserLevel failed (fail-closed)');
  }
  return describe(xp);
}

/**
 * Check whether a user has opted in to level-up DM notifications.
 *
 *   • If the user has an explicit row under NOTIFY_SERVICE (meta.optedIn === true),
 *     return true.
 *   • If the user has an explicit row under NOTIFY_SERVICE (meta.optedIn === false),
 *     return false. (Explicit opt-out.)
 *   • Otherwise, fall back to config.leveling.notifications.defaultEnabled.
 */
async function isNotifyEnabled(userJid) {
  const store = getStore();
  try {
    if (typeof store.getSubscriberMeta === 'function') {
      const meta = await store.getSubscriberMeta(NOTIFY_SERVICE, userJid);
      if (meta && typeof meta.optedIn === 'boolean') return meta.optedIn;
    }
  } catch (err) {
    logger.debug({ err, userJid }, 'isNotifyEnabled lookup failed');
  }
  return !!config?.leveling?.notifications?.defaultEnabled;
}

/**
 * Mark a user as having seen the first-XP hint (so we don't send it again).
 * Stored as meta.hintSeen = true under NOTIFY_SERVICE. If the user later
 * runs `.notify on`, we just flip optedIn = true on the same row.
 */
async function _markHintSeen(userJid) {
  const store = getStore();
  try {
    if (
      typeof store.isSubscriber === 'function' &&
      typeof store.addSubscriber === 'function' &&
      typeof store.updateSubscriberMeta === 'function'
    ) {
      const already = await store.isSubscriber(NOTIFY_SERVICE, userJid).catch(() => false);
      if (!already) {
        await store.addSubscriber(NOTIFY_SERVICE, userJid, { optedIn: false, hintSeen: true });
      } else {
        const cur =
          (await store.getSubscriberMeta(NOTIFY_SERVICE, userJid).catch(() => null)) || {};
        await store.updateSubscriberMeta(NOTIFY_SERVICE, userJid, {
          ...cur,
          hintSeen: true,
        });
      }
    }
  } catch (err) {
    logger.debug({ err, userJid }, 'markHintSeen failed (non-fatal)');
  }
}

async function _hasSeenHint(userJid) {
  const store = getStore();
  try {
    if (typeof store.getSubscriberMeta === 'function') {
      const m = await store.getSubscriberMeta(NOTIFY_SERVICE, userJid);
      return !!(m && m.hintSeen);
    }
  } catch (_) {
    /* swallow */
  }
  return false;
}

/**
 * awardForCommand — credit `cmd`'s XP to userJid.
 *
 * v1.16.0 signature extends with optional `sock` to enable the level-up
 * DM + first-XP hint paths. Callers that don't pass `sock` (e.g. unit
 * tests) get the v1.12.0 behaviour: XP is awarded, but no DM is sent.
 *
 * Returns: { awarded, total, leveledUp?, oldLevel?, newLevel? } | null
 */
async function awardForCommand(userJid, cmd, sock = null) {
  if (!userJid || !cmd) return null;
  const xp = xpForCommand(cmd);
  if (xp <= 0) return null;
  const store = getStore();
  let oldLevel = 1;
  let newTotal = 0;
  let leveledUp = false;
  let newLevel = 1;
  let wasFirstXp = false;

  try {
    if (typeof store.addUserXp !== 'function') return null;

    // Snapshot before — gives us pre-award level + tells us if this is the
    // user's very first XP gain (for the one-time hint).
    if (typeof store.getUserLevel === 'function') {
      const before = await store.getUserLevel(userJid).catch(() => null);
      const prevXp = before && typeof before.xp === 'number' ? before.xp : 0;
      oldLevel = describe(prevXp).level;
      wasFirstXp = !before || prevXp === 0;
    }

    newTotal = await store.addUserXp(userJid, xp);
    newLevel = describe(newTotal).level;
    leveledUp = newLevel > oldLevel;
  } catch (err) {
    logger.debug({ err, userJid, xp, cmd: cmd.name }, 'addUserXp failed (fail-closed)');
    return null;
  }

  // ─── Side-effects (DM hints) ─────────────────────────────────────
  // All side-effects are fire-and-forget; they NEVER block the runner
  // or surface errors to the caller.
  if (sock) {
    if (leveledUp) {
      try {
        if (await isNotifyEnabled(userJid)) {
          sock
            .sendMessage(userJid, {
              text:
                `🎉 *Level up!*\n\n` +
                `You reached *level ${newLevel}* (${newTotal.toLocaleString()} XP total).\n\n` +
                `_Run \`.profile\` to see your full progress, or \`.notify off\` to silence these DMs._`,
            })
            .catch((e) => logger.debug({ err: e, userJid }, 'levelup DM failed'));
        }
      } catch (_) {
        /* swallow */
      }
    } else if (
      wasFirstXp &&
      config?.leveling?.notifications?.hintOnFirstXp !== false &&
      !(await _hasSeenHint(userJid))
    ) {
      try {
        sock
          .sendMessage(userJid, {
            text:
              `✨ *You just earned your first XP* in EchoFox!\n\n` +
              `Run \`.notify on\` to get a DM every time you level up — ` +
              `or ignore this if you'd rather not. Run \`.profile\` any time ` +
              `to see your XP + level.`,
          })
          .catch(() => {});
        _markHintSeen(userJid).catch(() => {});
      } catch (_) {
        /* swallow */
      }
    }
  }

  return {
    awarded: xp,
    total: newTotal,
    leveledUp,
    oldLevel,
    newLevel,
  };
}

module.exports = {
  BASE_THRESHOLD,
  GROWTH_FACTOR,
  MAX_XP_MULTIPLIER,
  CATEGORY_XP,
  AI_COMMAND_NAMES,
  NOTIFY_SERVICE,
  // pure helpers (no I/O) — exported for tests
  xpFloorForLevel,
  describe,
  levelFor,
  xpForCommand,
  // I/O wrappers
  getLevel,
  awardForCommand,
  isNotifyEnabled,
};
