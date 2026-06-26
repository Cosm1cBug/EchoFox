/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * $leveling — bot-admin control surface for the leveling system (v1.16.0).
 *
 *   $leveling status                  show current multiplier + decay state
 *   $leveling decay on                enable XP decay sweep (process-local)
 *   $leveling decay off               disable XP decay sweep
 *   $leveling decay run               trigger an immediate sweep (any time)
 *   $leveling multiplier <0.1..5.0>   set global XP multiplier
 *   $leveling multiplier reset        reset multiplier to 1.0
 *
 * Auth: `admin: true` + the `$` prefix together — runner enforces both.
 * Group admins CANNOT toggle decay or change multiplier. The bot's
 * `config.admins` list is the only source of truth.
 *
 * Persistence:
 *   These commands mutate config.leveling in-memory via __testOverride
 *   (the process-local config override hook). Restart reverts to whatever
 *   config.js says. For permanent changes, edit config.js + restart.
 */

const { config, __testOverride } = require('../../lib/configLoader');
const decay = require('../../services/levelingDecayService');

function _fmtPct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function _fmtRel(tsMs) {
  if (!tsMs) return 'never';
  const age = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
  return `${Math.floor(age / 86400)}d ago`;
}

module.exports = {
  name: 'leveling',
  alias: ['lvl-admin', 'levelingadmin'],
  desc: '(admin) leveling system: decay toggle, XP multiplier, status',
  category: 'admin',
  admin: true,
  cooldown: 2,

  async start(sock, m, { ctx, args }) {
    const sub = (args[0] || 'status').toLowerCase();
    const arg2 = (args[1] || '').toLowerCase();

    // Make sure config.leveling.* is shaped — defaults set by configSchema,
    // but if user has a sparse config.js this is defensive.
    if (!config.leveling) config.leveling = {};
    if (!config.leveling.decay) config.leveling.decay = {};
    if (!config.leveling.notifications) config.leveling.notifications = {};

    if (sub === 'status' || sub === '') {
      const decayState = decay.getStatus();
      const mult = Number(config.leveling.xpMultiplier ?? 1.0);
      const lines = [
        '🎖️ *Leveling — admin status*',
        '',
        `*XP multiplier:* ${mult.toFixed(2)}x`,
        '',
        '*Decay:*',
        `• enabled: ${decayState.enabled ? '✅ on' : '🔕 off'}`,
        `• after: ${decayState.afterDays} days inactive`,
        `• rate: ${_fmtPct(decayState.percentPerWeek)} per week (compounding)`,
        `• sweep every: ${decayState.sweepIntervalMinutes}m`,
        `• timer: ${decayState.timerActive ? 'running' : 'stopped'}`,
        `• last run: ${_fmtRel(decayState.lastRunAt)} (affected ${decayState.lastRunAffected})`,
        '',
        '*Notifications:*',
        `• default for new users: ${config.leveling.notifications.defaultEnabled ? 'on' : 'off'}`,
        `• first-XP hint: ${config.leveling.notifications.hintOnFirstXp === false ? 'off' : 'on'}`,
        '',
        '_Run `$leveling decay on/off/run` or `$leveling multiplier <n>` to change._',
      ];
      return ctx.reply(lines.join('\n'));
    }

    if (sub === 'decay') {
      if (arg2 === 'on' || arg2 === 'enable') {
        __testOverride({
          leveling: { ...config.leveling, decay: { ...config.leveling.decay, enabled: true } },
        });
        return ctx.reply(
          '✅ *XP decay: enabled*\n\n' +
            `Inactive users (>${config.leveling.decay.afterDays}d) will lose ` +
            `${_fmtPct(config.leveling.decay.percentPerWeek)} of their XP per week.\n\n` +
            '_Process-local override. Restart reverts to config.js._',
        );
      }
      if (arg2 === 'off' || arg2 === 'disable') {
        __testOverride({
          leveling: { ...config.leveling, decay: { ...config.leveling.decay, enabled: false } },
        });
        return ctx.reply('🔕 *XP decay: disabled.*');
      }
      if (arg2 === 'run' || arg2 === 'now') {
        await ctx.react('🍂');
        const result = await decay.runOnce();
        if (!result.ran) {
          return ctx.reply(
            `⚠️ Decay didn't run: \`${result.reason}\`.\n\n` +
              '_If `disabled`, run `$leveling decay on` first._',
          );
        }
        return ctx.reply(`✅ Decay sweep complete: ${result.affected} user(s) affected.`);
      }
      return ctx.reply(
        '*Usage:*\n' +
          '• `$leveling decay on`   — enable decay\n' +
          '• `$leveling decay off`  — disable decay\n' +
          '• `$leveling decay run`  — run a sweep right now',
      );
    }

    if (sub === 'multiplier' || sub === 'mult' || sub === 'xp') {
      if (arg2 === 'reset') {
        __testOverride({ leveling: { ...config.leveling, xpMultiplier: 1.0 } });
        return ctx.reply('🔄 XP multiplier reset to *1.0x*.');
      }
      const v = Number(arg2);
      if (!Number.isFinite(v) || v < 0.1 || v > 5.0) {
        return ctx.reply(
          '*Usage:* `$leveling multiplier <0.1-5.0>` or `$leveling multiplier reset`\n\n' +
            '_Range is hard-capped 0.1–5.0 to prevent runaway inflation._',
        );
      }
      __testOverride({ leveling: { ...config.leveling, xpMultiplier: v } });
      return ctx.reply(
        `✅ XP multiplier set to *${v.toFixed(2)}x*.\n\n` +
          '_Affects all subsequent command XP awards. Process-local override._',
      );
    }

    return ctx.reply(
      '*Usage:*\n' +
        '`$leveling status`                  — show current state\n' +
        '`$leveling decay on|off|run`        — control XP decay\n' +
        '`$leveling multiplier <0.1-5.0>`    — set XP multiplier\n' +
        '`$leveling multiplier reset`        — reset to 1.0x',
    );
  },
};
