/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

module.exports = {
  name: 'ping',
  alias: ['p'],
  desc: 'Check ping and bot responsiveness.',
  category: 'misc',
  cooldown: 2,

  async start(sock, m, { ctx }) {
    const t0 = Date.now();
    await ctx.react('🏓');
    const sent = await ctx.reply('🏓 Pong!');
    const t1 = Date.now();
    // Some Baileys 7 variants return the sent message; if so, edit it with the timing.
    if (sent?.key) {
      await sock.sendMessage(ctx.chat, {
        text: `🏓 *Pong!* ${t1 - t0} ms`,
        edit: sent.key,
      }).catch(() => {});
    }
  },
};
