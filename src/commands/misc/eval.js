/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .exec  /  .>  (admin only)
 *
 *   $> <expression>   — evaluate JS in the bot's process
 *   $exec <shell cmd> — run a shell command and pipe stdout/stderr back
 *
 * ⚠️  DANGEROUS: this can execute arbitrary code. Gated by `admin: true`
 *    AND the user MUST be in config.admins. The router enforces this
 *    twice (once via admin prefix, once via cmd.admin) — but if you've
 *    misconfigured config.admins, the gate fails open.
 */

const { exec } = require('node:child_process');
const { format, promisify } = require('node:util');

const execAsync = promisify(exec);

const MAX_OUT = 3500; // WhatsApp soft text-message ceiling
const SHELL_TIMEOUT = 30_000;

function truncate(s) {
  if (s == null) return '';
  s = typeof s === 'string' ? s : format(s);
  if (s.length <= MAX_OUT) return s;
  return s.slice(0, MAX_OUT) + `\n…(truncated, ${s.length - MAX_OUT} more chars)`;
}

module.exports = {
  name: 'exec',
  alias: ['>'],
  desc: '(admin) Evaluate JS expression OR run shell command',
  category: 'misc',
  admin: true,
  noLimit: true,
  timeout: 35,

  async start(sock, m, { ctx, text, command }) {
    if (!text) return ctx.reply('Usage: `$> <js>` or `$exec <shell>`');

    // The router stripped the prefix and gave us the resolved command name
    // ('exec' or '>') — pick the mode accordingly.
    const isShell = command === 'exec';

    if (!isShell) {
      // ── JS eval branch ───────────────────────────────────────────────
      try {
        const wrap = text.includes('return')
          ? `(async () => { ${text} })()`
          : `(async () => { return ${text} })()`;
        // eslint-disable-next-line no-eval
        const result = await eval(wrap);
        await ctx.reply('```\n' + truncate(result) + '\n```');
      } catch (err) {
        await ctx.reply('💥 *eval threw*\n```\n' + truncate(err.stack || err.message) + '\n```');
      }
      return;
    }

    // ── Shell exec branch ────────────────────────────────────────────
    await ctx.react('⌛');
    try {
      const { stdout, stderr } = await execAsync(text, { timeout: SHELL_TIMEOUT, shell: true });
      const out =
        (stdout ? `*stdout*\n\`\`\`\n${truncate(stdout)}\n\`\`\`\n` : '') +
          (stderr ? `*stderr*\n\`\`\`\n${truncate(stderr)}\n\`\`\`\n` : '') || '_(no output)_';
      await ctx.reply(out);
    } catch (err) {
      await ctx.reply('💥 *exec failed*\n```\n' + truncate(err.message) + '\n```');
    }
  },
};
