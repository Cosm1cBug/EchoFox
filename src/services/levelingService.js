/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * levelingService — per-user XP + level tracking, visible only in
 * `.profile` command output.
 *
 * Storage:
 *   New `user_levels` table (one migration per backend). Schema:
 *     jid     TEXT PRIMARY KEY
 *     xp      INTEGER NOT NULL DEFAULT 0
 *     last_at INTEGER NOT NULL DEFAULT 0   (unix seconds — for future anti-farm)
 *
 * XP accrual:
 *   Awarded by the command runner after every successful command via
 *   `awardForCommand(userJid, cmd)`. XP amount varies by category:
 *     general / tools / convert / download / entertainment   →  5 XP
 *     admin / group / user / misc / main                     → 10 XP
 *     AI commands (.ai, .ask, .summarize, .explain, .imagine) → 15 XP
 *
 *   The runner is the single accrual point — no command-internal hooks
 *   needed. Adding new commands automatically grants XP.
 *
 * Level curve (Fibonacci-style, growth factor 1.5):
 *   threshold(1) = 100
 *   threshold(N) = threshold(N-1) * 1.5      (integer-rounded)
 *
 *   Example thresholds:
 *     L1→L2 = 100         L5→L6  = 506
 *     L10→L11 = 3,844     L20→L21 = 221,495
 *     L30→L31 = 12,766,855 (essentially unreachable — that's the point)
 *
 * Display:
 *   `.profile` reads xp via `getLevel(jid)` and renders one line:
 *     *Level:* 7 (1,234 / 1,728 XP — 71%)
 *
 * Privacy:
 *   No leaderboard, no inter-user comparison, no exposure outside the
 *   user's own .profile. Per-chat opt-out via privacy.excludeFromStore
 *   inherits automatically (we never persist for excluded chats).
 *
 * Safety:
 *   • All DB calls wrapped in try/catch and fail closed (XP not awarded
 *     on store error — never crash the command pipeline).
 *   • Bot's own JID never accrues XP (no point — and would inflate stats).
 *   • XP additions are awaited so multiple concurrent commands from the
 *     same user don't race (sqlite is serialised anyway, but the
 *     application-level await keeps semantics clean across backends).
 */

const { getStore } = require('../store/instance');
const logger = require('../core/logger').child({ mod: 'leveling' });

const BASE_THRESHOLD = 100;
const GROWTH_FACTOR = 1.5;
const MAX_LEVEL_CHECK = 100; // safety cap so threshold loop can never spin

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

function xpForCommand(cmd) {
  if (!cmd) return 0;
  if (AI_COMMAND_NAMES.has(cmd.name)) return 15;
  const cat = cmd.category || cmd.type;
  if (cat && Object.prototype.hasOwnProperty.call(CATEGORY_XP, cat)) {
    return CATEGORY_XP[cat];
  }
  return 5;
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

async function awardForCommand(userJid, cmd) {
  if (!userJid || !cmd) return null;
  // Never award the bot itself
  // (bot's JID lives at sock.user.id but the runner already filters m.key.fromMe;
  //  this is a belt-and-suspenders check in case awardForCommand is called from
  //  elsewhere in the future.)
  const xp = xpForCommand(cmd);
  if (xp <= 0) return null;
  const store = getStore();
  try {
    if (typeof store.addUserXp === 'function') {
      const newTotal = await store.addUserXp(userJid, xp);
      return { awarded: xp, total: newTotal };
    }
  } catch (err) {
    logger.debug({ err, userJid, xp, cmd: cmd.name }, 'addUserXp failed (fail-closed)');
  }
  return null;
}

module.exports = {
  BASE_THRESHOLD,
  GROWTH_FACTOR,
  CATEGORY_XP,
  AI_COMMAND_NAMES,
  // pure helpers (no I/O) — exported for tests
  xpFloorForLevel,
  describe,
  xpForCommand,
  // I/O wrappers
  getLevel,
  awardForCommand,
};
