/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';
/**
 * commandRunner — single safe entry point for executing a command.
 *
 *   • per-command timeout (default 60s, override via cmd.timeout)
 *   • per-user per-command cooldown (cmd.cooldown, seconds)
 *   • global limiter for bot-wide command floods
 *   • centralised try/catch:
 *       - ❌ reaction on the offending message
 *       - friendly reply to user
 *       - structured log line
 *       - optional post to config.channels.errLogs
 *   • emits typed metrics via src/services/metrics.js (no string typos)
 *   • warmup-mode aware: when antiBan.warmupMode is true, cooldowns and
 *     global throughput are multiplied by antiBan.warmupMultiplier for
 *     the first antiBan.warmupDays days after first boot.
 */
const { LRUCache } = require('lru-cache');
const logger = require('./logger').child({ mod: 'runner' });
const { makeRateLimiter } = require('../middleware/rateLimit');
const { config }   = require('../lib/configLoader');
const metrics      = require('../services/metrics');
const alertEngine  = require('../services/alertEngine');
const { isUserFacingError, shouldCountAsFailure } = require('../lib/errors');

const DEFAULT_TIMEOUT_MS = 60_000;
const cooldowns = new LRUCache({ max: 100_000, ttl: 1000 * 60 * 10 });

// Compute the effective rate-limit multiplier during the warmup window.
//   Returns 1 if warmupMode is off OR we're past warmupDays since first boot.
//   Returns config.antiBan.warmupMultiplier otherwise (default 3 → 3× stricter).
//
// "First boot" = the bot_started_at gauge. If unset, treat as "now" so the
// multiplier applies for the configured warmupDays from this restart on.
const _bootTs = Math.floor(Date.now() / 1000);
function warmupMultiplier() {
  const ab = config.antiBan || {};
  if (!ab.warmupMode) return 1;
  const days = ab.warmupDays ?? 14;
  if (days <= 0) return ab.warmupMultiplier ?? 3;
  const elapsedDays = (Math.floor(Date.now() / 1000) - _bootTs) / 86400;
  if (elapsedDays >= days) return 1;
  return ab.warmupMultiplier ?? 3;
}

// Global limiter — consumes warmupMultiplier() tokens per call so warmup
// proportionally throttles bot-wide throughput.
const globalLimiter = makeRateLimiter({
  capacity:     Math.max(config.processing.globalRateLimit * 4, 20),
  refillPerSec: config.processing.globalRateLimit,
});

function checkCooldown(sender, cmd) {
  if (!cmd.cooldown || cmd.cooldown <= 0) return 0;
  const mult = warmupMultiplier();
  const effectiveMs = cmd.cooldown * 1000 * mult;
  const key  = `${sender}|${cmd.name}`;
  const last = cooldowns.get(key);
  const now  = Date.now();
  if (last && now - last < effectiveMs) {
    return Math.ceil((effectiveMs - (now - last)) / 1000);
  }
  cooldowns.set(key, now);
  return 0;
}

function withTimeout(promise, ms, cmdName) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(
      () => reject(Object.assign(
        new Error(`Command '${cmdName}' timed out after ${ms} ms`),
        { code: 'ETIMEDOUT' },
      )),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function postCrashToChannel(sock, cmd, ctx, err) {
  const ch = config.channels.errLogs;
  if (!ch) return;
  const txt =
    `🔥 *Command crashed*\n` +
    `*Cmd:* \`${cmd.name}\`  *Cat:* \`${cmd.category || '?'}\`\n` +
    `*From:* ${ctx.sender}  *Chat:* ${ctx.chat}\n` +
    `*Text:* ${(ctx.body || '').slice(0, 200)}\n\n` +
    '```\n' + (err.stack || err.message || String(err)).slice(0, 1500) + '\n```';
  try { await sock.sendMessage(ch, { text: txt }); }
  catch (_e) { /* don't crash the runner because the log channel is down */ }
}

async function run({ sock, cmd, m, ctx, handlerArgs }) {
  // Global limiter (bot-wide flood protection)
  if (!cmd.noLimit && !globalLimiter.tryConsume('__global__', warmupMultiplier())) {
    metrics.incRateLimit();
    logger.warn({ cmd: cmd.name, sender: ctx.sender }, 'global rate-limit exceeded');
    return ctx.reply('⏱️ Bot is very busy. Try again in a moment.');
  }

  // Per-user per-command cooldown
  const wait = checkCooldown(ctx.sender, cmd);
  if (wait > 0) {
    metrics.incCooldown();
    return ctx.reply(`⌛ Wait ${wait}s before using *${cmd.name}* again.`);
  }

  const timeoutMs = (cmd.timeout && cmd.timeout > 0)
    ? cmd.timeout * 1000
    : DEFAULT_TIMEOUT_MS;

  const t0 = Date.now();
  try {
    await withTimeout(cmd.start(sock, m, handlerArgs), timeoutMs, cmd.name);
    metrics.incCommand(cmd.name, 'success');
    alertEngine.record(cmd.name, 'success');
    logger.debug({ cmd: cmd.name, ms: Date.now() - t0, sender: ctx.sender }, 'command ok');
  } catch (err) {
    const isTimeout    = err.code === 'ETIMEDOUT';
    const userFacing   = isUserFacingError(err);
    const countFailure = shouldCountAsFailure(err);

    // Outcome category for metrics + alerts
    const outcome = isTimeout ? 'timeout'
                  : countFailure ? 'failure'
                  : 'handled';

    metrics.incCommand(cmd.name, outcome === 'handled' ? 'success' : outcome);
    alertEngine.record(cmd.name, outcome === 'handled' ? 'success' : outcome);

    // User-facing errors get a clean reply, no stack log, no ❌
    if (userFacing) {
      logger.debug({ cmd: cmd.name, sender: ctx.sender, msg: err.message }, 'command rejected user input');
      try { await ctx.reply(err.message || 'Bad input'); } catch {}
      return;
    }

    logger.error(
      { err, cmd: cmd.name, sender: ctx.sender, ms: Date.now() - t0, timeout: isTimeout, kind: err.kind || 'bug' },
      'command threw',
    );

    let userMsg;
    if (isTimeout) {
      userMsg = `⏱️ *${cmd.name}* took too long and was aborted.`;
    } else if (err.kind === 'upstream') {
      userMsg = `🌐 *${err.upstream || 'External service'}* is having issues. Try again shortly.`;
    } else if (err.kind === 'config') {
      userMsg = `⚙️ *${cmd.name}* is misconfigured (\`${err.configPath || '?'}\`). Bot operator must fix.`;
    } else {
      userMsg = `💥 *${cmd.name}* crashed: ${(err.message || String(err)).slice(0, 200)}`;
    }

    try { await ctx.react('❌'); } catch {}
    try { await ctx.reply(userMsg); } catch {}
    if (countFailure) postCrashToChannel(sock, cmd, ctx, err).catch(() => {});
  }

}

module.exports = { run };