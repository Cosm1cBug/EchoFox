/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .approve +<phone>
 *
 * Approves a pending join-request for the given user in the current group.
 * Requires: bot is admin AND caller is admin in the group.
 */
module.exports = {
  name: 'approve',
  alias: ['accept'],
  desc: 'Approve a pending join request in this group',
  category: 'group',
  group: true, // group-only (router enforces)
  needsMetadata: true, // we get group metadata pre-fetched

  async start(sock, m, { ctx, metadata, text }) {
    const target = (text || '').trim();
    if (!target.startsWith('+')) {
      return ctx.reply(
        'Usage: `.approve +<countrycode><number>`\n_Example: .approve +919876543210_',
      );
    }

    // Find the bot's own JID inside the group
    const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
    const me = metadata?.participants?.find((p) => p.id === botJid);
    if (!me || !me.admin) {
      return ctx.reply('🚫 I need to be an admin of this group to approve requests.');
    }

    // Caller must also be admin
    const caller = metadata?.participants?.find((p) => p.id === ctx.sender);
    if (!caller || !caller.admin) {
      return ctx.reply('🔒 Only group admins can approve join requests.');
    }

    // Make sure the user actually has a pending request
    let pending;
    try {
      pending = await sock.groupRequestParticipantsList(ctx.chat);
    } catch (err) {
      return ctx.reply(`Could not list pending requests: ${err.message}`);
    }

    const wantedRaw = target.replace(/^\+/, '');
    const wantedJid = `${wantedRaw}@s.whatsapp.net`;
    const match = (pending || []).find((p) => p.jid === wantedJid);
    if (!match) {
      return ctx.reply(`No pending join request from *+${wantedRaw}* in this group.`);
    }

    try {
      await sock.groupRequestParticipantsUpdate(ctx.chat, [wantedJid], 'approve');
      await ctx.react('✅');
      return ctx.reply(`✅ Approved join request from *+${wantedRaw}*.`);
    } catch (err) {
      return ctx.reply(`Approval failed: ${err.message}`);
    }
  },
};
