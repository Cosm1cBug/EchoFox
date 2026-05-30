/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .ctx
 *
 * Diagnostic: prints the parsed `ctx` view of the message that invoked
 * it. Useful when authoring new commands — lets you see what fields are
 * actually populated for a given message type.
 *
 * Replaces the old `ctx.js` which was a UI demo for InteractiveMessage
 * carousels — those break on most WhatsApp clients and exposed brittle
 * brand strings. If you want the carousel back, copy it from
 * `general/ctx.js` in the v0.4.0 tag.
 */

module.exports = {
  name: 'ctxi',
  alias: ['inspect', 'whoami'],
  desc: 'Print the parsed message context (debug helper)',
  category: 'general',
  cooldown: 3,

  async start(sock, m, { ctx, args }) {
    const summary = {
      sender:    ctx.sender,
      chat:      ctx.chat,
      isGroup:   ctx.isGroup,
      isPrivate: ctx.isPrivate,
      mtype:     ctx.mtype,
      pushName:  ctx.pushName,
      timestamp: new Date(ctx.timestamp * 1000).toISOString(),
      hasQuoted: !!ctx.quoted,
      quotedType: ctx.quoted?.type || null,
      mentionsCount: ctx.mentions?.length || 0,
      args,
    };

    const fmt = JSON.stringify(summary, null, 2);
    await ctx.reply('```json\n' + fmt + '\n```');
  },
};
