/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .healthcheck  (alias: .health)  — admin only
 *
 * Runs the full diagnostics suite and replies with a per-subsystem
 * summary. Same data the dashboard's /api/diagnostics endpoint returns,
 * just formatted for WhatsApp.
 */

const { runDiagnostics, getRuntimeContext } = require('../../lib/diagnostics');

function fmtMs(ms) {
  return `${ms}ms`;
}
function fmtBytes(n) {
  if (!n) return '0';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${u[i]}`;
}

module.exports = {
  name: 'healthcheck',
  alias: ['health', 'diag', 'diagnostics'],
  desc: '(admin) Run a full self-diagnostic and reply with a summary',
  category: 'admin',
  admin: true,
  noLimit: true,
  cooldown: 10,
  timeout: 15,

  async start(sock, m, { ctx }) {
    await ctx.react('🩺');

    const ctxRuntime = getRuntimeContext();
    const report = await runDiagnostics(ctxRuntime);

    const lines = [
      `🩺 *EchoFox Health Check* — overall: ${report.ok ? '✅ OK' : '❌ DEGRADED'}`,
      '',
    ];

    for (const [name, c] of Object.entries(report.checks)) {
      const icon = c.ok ? '✅' : '❌';
      lines.push(`*${icon} ${name}* (${fmtMs(c.ms)})`);
      if (c.error) {
        lines.push(`   _${c.error}_`);
        continue;
      }
      if (!c.details) continue;

      // Specific renderers for the most useful subsystems
      switch (name) {
        case 'host':
          lines.push(
            `   RSS ${fmtBytes(c.details.rssBytes)} · heap ${c.details.heapPercent}% · uptime ${c.details.uptimeSec}s · node ${c.details.nodeVersion}`,
          );
          break;
        case 'baileys':
          lines.push(`   ${c.details.userJid} · queue depth ${c.details.sendQueueDepth ?? 'n/a'}`);
          break;
        case 'store':
          lines.push(
            `   ${c.details.backend} · ${c.details.counters} counters · ${c.details.gauges} gauges · ${c.details.roundTrip}`,
          );
          break;
        case 'commands':
          lines.push(
            `   ${c.details.loaded} loaded · ${c.details.aliases} aliases · ${c.details.skipped} skipped`,
          );
          break;
        case 'caches': {
          const pairs = Object.entries(c.details)
            .map(([k, v]) => `${k.replace('Cache', '')}=${v}`)
            .join(', ');
          if (pairs) lines.push(`   ${pairs}`);
          break;
        }
        case 'alerts': {
          if (!c.details.initialized) {
            lines.push(`   not initialised`);
            break;
          }
          if (!c.details.activeCount) {
            lines.push(`   no active alerts`);
            break;
          }
          lines.push(
            `   ⚠️ ${c.details.activeCount} active: ${c.details.commandsBelowThreshold.join(', ')}`,
          );
          break;
        }
        case 'config':
          lines.push(
            `   source=${c.details.source} · store=${c.details.storeBackend} · auth=${c.details.authBackend} · login=${c.details.loginType}`,
          );
          break;
        case 'network':
          lines.push(
            `   proxy=${c.details.proxyConfigured ? 'yes' : 'no'} · extraCAs=${c.details.extraCAs ? 'yes' : 'no'} · ws=${c.details.wsAgent}`,
          );
          break;
        case 'auth':
          lines.push(`   backend=${c.details.backend} · registered=${c.details.registered}`);
          break;
        case 'metrics':
          lines.push(
            `   ${c.details.countersTracked} counters · ${c.details.gaugesTracked} gauges · uptime ${c.details.uptimeSec}s`,
          );
          break;
      }
    }

    lines.push('', `_Report at ${new Date(report.ts * 1000).toISOString()}_`);

    await ctx.reply(lines.join('\n'));
  },
};
