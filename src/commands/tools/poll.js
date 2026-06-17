/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .poll — create a native WhatsApp poll in the current chat.
 *
 *   .poll "Question" "Option A" "Option B" ["Option C" ...]
 *   .poll "Best language?" Python JS Rust Go
 *   .poll -m "Lunch?" Pizza Sushi Burgers       (multi-select)
 *
 * Quote-aware arg parser supports both "double-quoted" and 'single-quoted'
 * options so users can include spaces inside an option. Bare tokens are
 * treated as single-word options.
 *
 * Limits (WhatsApp protocol):
 *   • 1 question (≤ 255 chars)
 *   • 2–12 options
 *   • Each option ≤ 100 chars
 *   • selectableCount: 1 (single-select, default) or options.length (multi)
 *
 * Native polls send via Baileys' `poll` message field — recipients see
 * the standard WA poll UI and tally is handled by WhatsApp itself, so
 * we don't need a `!pollresults` command.
 */

const MIN_OPTS = 2;
const MAX_OPTS = 12;
const MAX_Q_LEN = 255;
const MAX_OPT_LEN = 100;

function tokenize(input) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

module.exports = {
  name: 'poll',
  alias: ['vote'],
  desc: 'Create a native WhatsApp poll.',
  category: 'tools',
  type: 'tools',
  usage: '[-m] "Question" "Opt A" "Opt B" [...]',
  cooldown: 5,

  async start(sock, m, { ctx, text }) {
    const raw = String(text || '').trim();
    if (!raw) {
      return ctx.reply(
        '📊 *Poll*\n\n' +
          'Usage:\n' +
          '`.poll "Question" "Option 1" "Option 2" [...]`\n' +
          '`.poll -m "Question" Pizza Sushi Burgers`  (multi-select)\n\n' +
          'Examples:\n' +
          '• `.poll "Best language?" Python JS Rust Go`\n' +
          '• `.poll "Lunch?" "Pad Thai" "Margherita Pizza" Burgers`',
      );
    }

    // ─── flag parsing ─────────────────────────────────────────────────
    let multi = false;
    let rest = raw;
    const flagMatch = rest.match(/^\s*(-m|--multi)\s+/);
    if (flagMatch) {
      multi = true;
      rest = rest.slice(flagMatch[0].length);
    }

    const tokens = tokenize(rest);
    if (tokens.length < 1 + MIN_OPTS) {
      return ctx.reply(
        `❌ Need a question + at least ${MIN_OPTS} options.\n` +
          'Try `.poll` (no args) for usage examples.',
      );
    }

    const [question, ...options] = tokens;

    if (question.length > MAX_Q_LEN) {
      return ctx.reply(`❌ Question too long (max ${MAX_Q_LEN} chars).`);
    }
    if (options.length > MAX_OPTS) {
      return ctx.reply(`❌ Too many options (max ${MAX_OPTS}).`);
    }
    const tooLong = options.find((o) => o.length > MAX_OPT_LEN);
    if (tooLong) {
      return ctx.reply(
        `❌ Option "${tooLong.slice(0, 30)}..." too long (max ${MAX_OPT_LEN} chars).`,
      );
    }
    const deduped = Array.from(new Set(options.map((o) => o.trim()))).filter(Boolean);
    if (deduped.length < MIN_OPTS) {
      return ctx.reply(`❌ Need at least ${MIN_OPTS} distinct, non-empty options.`);
    }

    await ctx.react('📊');

    await sock.sendMessage(ctx.chat, {
      poll: {
        name: question,
        values: deduped,
        selectableCount: multi ? deduped.length : 1,
      },
    });
  },
};
