/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .serverinfo (admin)
 *
 * Reports host + process vitals. Useful for verifying which machine the
 * bot is running on when you have multiple deployments.
 */

const os = require('node:os');
const { runtime: humanDuration } = require('../../lib/Func');

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (Math.abs(bytes) >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}

module.exports = {
  name: 'serverinfo',
  alias: ['sinfo', 'host'],
  desc: '(admin) Show host + process vitals',
  category: 'admin',
  admin: true,
  noLimit: true,

  async start(sock, m, { ctx, config }) {
    const t0 = Date.now();
    const mem = process.memoryUsage();
    const load = os.loadavg();

    const lines = [
      '`</> Server Details </>`',
      '',
      '`Host`',
      `*Hostname:* ${os.hostname()}`,
      `*Platform:* ${os.platform()} ${os.release()}`,
      `*Arch:*     ${os.arch()}`,
      `*CPUs:*     ${os.cpus().length}× ${os.cpus()[0]?.model || 'unknown'}`,
      `*Load:*     ${load.map((n) => n.toFixed(2)).join(' / ')} (1/5/15 m)`,
      '',
      '`Memory (Host)`',
      `*Total:* ${formatBytes(os.totalmem())}`,
      `*Used:*  ${formatBytes(os.totalmem() - os.freemem())}`,
      `*Free:*  ${formatBytes(os.freemem())}`,
      '',
      '`Memory (Bot Process)`',
      `*RSS:*       ${formatBytes(mem.rss)}`,
      `*Heap used:* ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}`,
      `*External:*  ${formatBytes(mem.external)}`,
      '',
      '`Runtime`',
      `*Node:*  ${process.version}`,
      `*Host:*  ${humanDuration(os.uptime())}`,
      `*Bot:*   ${humanDuration(process.uptime())}`,
      `*PID:*   ${process.pid}`,
      '',
      '`Backends`',
      `*Store:* ${config.storeDB.type}`,
      `*Auth:*  ${config.auth.method}`,
      `*Login:* ${config.login.type}`,
      '',
      `*Round-trip:* ${Date.now() - t0} ms`,
      '',
      '> EchoFox',
    ];

    await ctx.reply(lines.join('\n'));
  },
};
