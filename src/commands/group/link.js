/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .link
 *
 * Returns the current group's invite link. Group-only. Requires:
 *   • bot must be admin (to fetch invite code)
 *   • caller must be admin
 */

module.exports = {
  name: 'link',
  alias: ['grouplink', 'invite'],
  desc: 'Get the invite link for this group',
  category: 'group',
  group: true,
  needsMetadata: true,
  cooldown: 10,

  async start(sock, m, { ctx, metadata }) {
    const botId = sock.user?.id
      ? `${sock.user.id.split(':')[0].split('@')[0]}@s.whatsapp.net`
      : null;
    const me = metadata?.participants?.find((p) => p.id === botId);
    const caller = metadata?.participants?.find((p) => p.id === ctx.sender);

    if (!me?.admin) return ctx.reply('🚫 I need to be an admin to fetch the invite link.');
    if (!caller?.admin) return ctx.reply('🔒 Only group admins can request the invite link.');

    try {
      const code = await sock.groupInviteCode(ctx.chat);
      await ctx.reply(`🔗 https://chat.whatsapp.com/${code}`);
    } catch (err) {
      throw new Error(`Could not fetch invite link: ${err.message}`);
    }
  },
};
