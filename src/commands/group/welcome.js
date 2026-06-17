/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .welcome — manage this group's welcome & goodbye templates.
 *
 *   .welcome                                → show current config
 *   .welcome on | off                       → toggle welcome
 *   .welcome bye on | off                   → toggle goodbye
 *   .welcome set <template>                 → set welcome template
 *   .welcome bye set <template>             → set goodbye template
 *   .welcome reset                          → reset welcome to default
 *   .welcome bye reset                      → reset goodbye to default
 *   .welcome test                           → preview both templates with sample data
 *
 * Templates may use {user}, {group}, {count} placeholders. The actual
 * dispatch (sending the message on join/leave) happens in
 * src/events/group-participants.update.js — this command only manages
 * the config blob.
 *
 * Group-admin-only (caller must be admin in the group).
 */

const greetings = require('../../services/greetingService');

module.exports = {
  name: 'welcome',
  alias: ['greet', 'goodbye'],
  desc: "Configure this group's welcome/goodbye messages.",
  category: 'group',
  type: 'group',
  group: true,
  needsMetadata: true,
  usage: '[bye] [on|off|set <template>|reset|test]',
  cooldown: 3,

  async start(sock, m, { ctx, metadata, text }) {
    // Caller must be a group admin
    const caller = metadata?.participants?.find((p) => p.id === ctx.sender);
    if (!caller?.admin) {
      return ctx.reply('🔒 Only group admins can configure welcome/goodbye messages.');
    }

    const cfg = await greetings.getConfig(ctx.chat);
    const groupName = metadata?.subject || 'this group';
    const groupCount = metadata?.participants?.length ?? '?';

    const raw = String(text || '').trim();

    // ─── No args → show status ────────────────────────────────────────
    if (!raw) {
      return ctx.reply(
        '👋 *Greeting config*\n\n' +
          `*Welcome:* ${cfg.welcomeEnabled ? '✅ on' : '❌ off'}\n` +
          `   _${truncate(cfg.welcomeTemplate, 100)}_\n\n` +
          `*Goodbye:* ${cfg.goodbyeEnabled ? '✅ on' : '❌ off'}\n` +
          `   _${truncate(cfg.goodbyeTemplate, 100)}_\n\n` +
          '*Manage:*\n' +
          '• `.welcome on` / `.welcome off`\n' +
          '• `.welcome bye on` / `.welcome bye off`\n' +
          '• `.welcome set <template>`\n' +
          '• `.welcome bye set <template>`\n' +
          '• `.welcome reset` / `.welcome bye reset`\n' +
          '• `.welcome test`\n\n' +
          '_Placeholders: `{user}`, `{group}`, `{count}`_',
      );
    }

    const tokens = raw.split(/\s+/);
    const isBye = tokens[0].toLowerCase() === 'bye';
    const verb = (isBye ? tokens[1] : tokens[0])?.toLowerCase();
    const rest = (isBye ? tokens.slice(2) : tokens.slice(1)).join(' ').trim();
    const which = isBye ? 'goodbye' : 'welcome';

    // ─── test (no toggle needed) ──────────────────────────────────────
    if (verb === 'test') {
      const sample = { userJid: ctx.sender, groupName, count: groupCount };
      const w = greetings.renderTemplate(cfg.welcomeTemplate, sample);
      const g = greetings.renderTemplate(cfg.goodbyeTemplate, sample);
      return ctx.reply(
        '🔎 *Template preview*\n\n' +
          `*Welcome (${cfg.welcomeEnabled ? 'on' : 'off'}):*\n${w}\n\n` +
          `*Goodbye (${cfg.goodbyeEnabled ? 'on' : 'off'}):*\n${g}`,
      );
    }

    // ─── on / off toggle ──────────────────────────────────────────────
    if (verb === 'on' || verb === 'off') {
      const flag = verb === 'on';
      const patch = isBye ? { goodbyeEnabled: flag } : { welcomeEnabled: flag };
      await greetings.setConfig(ctx.chat, patch);
      await ctx.react(flag ? '✅' : '🚫');
      return ctx.reply(`${flag ? '✅' : '🚫'} *${which}* messages are now *${verb}*.`);
    }

    // ─── reset to default ─────────────────────────────────────────────
    if (verb === 'reset') {
      const patch = isBye
        ? { goodbyeTemplate: greetings.DEFAULT_GOODBYE }
        : { welcomeTemplate: greetings.DEFAULT_WELCOME };
      await greetings.setConfig(ctx.chat, patch);
      await ctx.react('♻️');
      return ctx.reply(`♻️ Reset *${which}* template to default.`);
    }

    // ─── set <template> ───────────────────────────────────────────────
    if (verb === 'set') {
      if (!rest) return ctx.reply(`Usage: \`.welcome ${isBye ? 'bye ' : ''}set <template>\``);
      const err = greetings.validateTemplate(rest);
      if (err) return ctx.reply(`❌ ${err}`);
      const patch = isBye ? { goodbyeTemplate: rest } : { welcomeTemplate: rest };
      await greetings.setConfig(ctx.chat, patch);
      await ctx.react('✏️');
      return ctx.reply(
        `✏️ *${which}* template updated.\n\n_Preview:_\n` +
          greetings.renderTemplate(rest, {
            userJid: ctx.sender,
            groupName,
            count: groupCount,
          }),
      );
    }

    return ctx.reply(`Unknown verb *${verb}*. Send \`.welcome\` for usage.`);
  },
};

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}
