/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';
/**
 * commandRunner — the single entry point for executing a command safely.
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Responsibilities                                                 │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  • per-command timeout (default 60 s, cmd.timeout overrides)     │
 *   │  • per-user per-command cooldown (cmd.cooldown, default 0)       │
 *   │  • global outbound rate-limit gate                                │
 *   │  • centralised try/catch with:                                    │
 *   │      - error reaction (❌) on the offending message               │
 *   │      - friendly reply to the user                                 │
 *   │      - structured log line                                        │
 *   │      - optional crash post to config.channels.errLogs            │
 *   │  • analytics: success/failure/timeout counters                    │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Why a dedicated module rather than inlining in messages.upsert?
 *   • It's testable in isolation (mock the sock + cmd, assert behaviour).
 *   • It keeps the hot path in messages.upsert.js readable.
 *   • Future features (audit log, before/after hooks, plugins) land here.
 */

const { LRUCache }      = require('lru-cache');
const logger            = require('./logger').child({ mod: 'runner' });
const { makeRateLimiter } = require('../middleware/rateLimit');
const { config }        = require('../lib/configLoader');

// ─── State ───────────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 60_000;
const cooldowns = new LRUCache({ max: 100_000, ttl: 1000 * 60 * 10 });

// One global limiter for command *invocations* (anti-abuse) — cheap and broad.
const globalLimiter = makeRateLimiter({ capacity: 20, refillPerSec: 5 });

// Counters (consumed by /metrics if you wire them in later)
const counters = {
  total: 0,
  success: 0,
  failure: 0,
  timeout: 0,
  cooldown: 0,
  ratelimit: 0,
};

// ─── Helpers ─────────────────────────────────────────────────────────────
function cooldownKey(sender, cmdName) {
  return `${sender}|${cmdName}`;
}

function checkCooldown(sender, cmd) {
  if (!cmd.cooldown || cmd.cooldown <= 0) return 0;
  const key = cooldownKey(sender, cmd.name);
  const lastRun = cooldowns.get(key);
  const now = Date.now();
  if (lastRun && now - lastRun < cmd.cooldown * 1000) {
    return Math.ceil((cmd.cooldown * 1000 - (now - lastRun)) / 1000);
  }
  cooldowns.set(key, now);
  return 0;
}

function withTimeout(promise, ms, cmdName) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(`Command '${cmdName}' timed out after ${ms} ms`), { code: 'ETIMEDOUT' })),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function postCrashToChannel(sock, cmd, ctx, err) {
  const ch = config.channels.errLogs;
  if (!ch) return;                                          // gracefully skip
  const txt =
    `🔥 *Command crashed*\n` +
    `*Cmd:* \`${cmd.name}\`  *Cat:* \`${cmd.category}\`\n` +
    `*From:* ${ctx.sender}  *Chat:* ${ctx.chat}\n` +
    `*Text:* ${(ctx.body || '').slice(0, 200)}\n\n` +
    `\`\`\`\n${(err.stack || err.message || String(err)).slice(0, 1500)}\n\`\`\``;
  try { await sock.sendMessage(ch, { text: txt }); }
  catch (_e) { /* don't crash the runner because the log channel is down */ }
}

// ─── Main entry ──────────────────────────────────────────────────────────
async function run({ sock, cmd, m, ctx, handlerArgs }) {
  counters.total++;

  // 1. Global limiter (cheap, fires per command invocation)
  if (!cmd.noLimit && !globalLimiter.tryConsume('__global__')) {
    counters.ratelimit++;
    logger.warn({ cmd: cmd.name, sender: ctx.sender }, 'global rate-limit exceeded');
    return ctx.reply('⏱️ Bot is very busy. Try again in a moment.');
  }

  // 2. Per-user per-command cooldown
  const wait = checkCooldown(ctx.sender, cmd);
  if (wait > 0) {
    counters.cooldown++;
    return ctx.reply(`⌛ Wait ${wait}s before using *${cmd.name}* again.`);
  }

  // 3. Execute with timeout
  const timeoutMs = (cmd.timeout && cmd.timeout > 0)
    ? cmd.timeout * 1000
    : DEFAULT_TIMEOUT_MS;

  const startedAt = Date.now();
  try {
    await withTimeout(cmd.start(sock, m, handlerArgs), timeoutMs, cmd.name);
    counters.success++;
    logger.debug(
      { cmd: cmd.name, ms: Date.now() - startedAt, sender: ctx.sender },
      'command ok',
    );
  } catch (err) {
    const isTimeout = err.code === 'ETIMEDOUT';
    if (isTimeout) counters.timeout++; else counters.failure++;

    logger.error(
      { err, cmd: cmd.name, sender: ctx.sender, ms: Date.now() - startedAt, timeout: isTimeout },
      'command threw',
    );

    // Friendly reply (truncated, no stack to the user)
    const userMsg = isTimeout
      ? `⏱️ *${cmd.name}* took too long and was aborted.`
      : `💥 *${cmd.name}* crashed: ${(err.message || String(err)).slice(0, 200)}`;
    try { await ctx.react('❌'); } catch {}
    try { await ctx.reply(userMsg); } catch {}

    // Async post to ops channel (don't await)
    postCrashToChannel(sock, cmd, ctx, err).catch(() => {});
  }
}

function getCounters() {
  return { ...counters };
}

module.exports = { run, getCounters };
