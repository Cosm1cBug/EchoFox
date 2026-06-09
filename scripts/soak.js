#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Synthetic soak harness.
 *
 *   $ node scripts/soak.js [--durationMin=60] [--rate=10] [--snapshot=1]
 *
 *   Spins up the bot's command pipeline with a mock Baileys socket,
 *   fires N synthetic inbound messages per minute, captures heap +
 *   metrics at intervals, and reports any growth trend.
 *
 *   Options:
 *     --durationMin   how long to run (default 60)
 *     --rate          synthetic messages per minute (default 10)
 *     --snapshot      take heap snapshots every N minutes (default 0 = off)
 *     --out=<dir>     where to write snapshots + report (default ./soak-out)
 *
 *   Output:
 *     <out>/report.json          per-minute metrics
 *     <out>/heap-T<N>.heapsnapshot   (if --snapshot)
 *     <out>/summary.txt          human-readable summary at end
 *
 *   This is a LOCAL synthetic test. It exercises the command pipeline
 *   + store + event router, but not Baileys' real socket layer. Use it
 *   to catch memory leaks in YOUR code before a real-world soak.
 */

const fs   = require('node:fs');
const path = require('node:path');
const v8   = require('node:v8');

function arg(flag, def) {
  const a = process.argv.find((x) => x.startsWith(`--${flag}=`));
  return a ? a.slice(`--${flag}=`.length) : def;
}

const DURATION_MIN = Number(arg('durationMin', '60'));
const RATE_PER_MIN = Number(arg('rate', '10'));
const SNAP_EVERY_MIN = Number(arg('snapshot', '0'));
const OUT_DIR = arg('out', './soak-out');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

process.env.NODE_ENV = 'test';

const { __testOverride } = require('../src/lib/configLoader');
__testOverride({ storeDB: { sqlitePath: ':memory:', runMigrationsOnBoot: true } });

const lifecycle = require('../src/core/lifecycle');
const { makeMockSock, makeMockMessage } = require('../src/__tests__/helpers/mockSock');

console.log(`[soak] starting — duration=${DURATION_MIN}min, rate=${RATE_PER_MIN}/min, snapshots every ${SNAP_EVERY_MIN || 'off'}min`);
console.log(`[soak] output → ${OUT_DIR}`);

const samples = [];        // { minute, rssMB, heapUsedMB, heapTotalMB, sentCount, recvCount }
let sentCount = 0;

async function run() {
  const store = await lifecycle.selectStore();
  const sock = makeMockSock();
  const handleMessage = require('../src/events/messages.upsert');

  const startTs = Date.now();
  const endTs = startTs + DURATION_MIN * 60 * 1000;

  // Per-second message firing — RATE_PER_MIN/60 msgs per tick
  const msgsPerTick = Math.max(1, Math.round(RATE_PER_MIN / 60));
  const fireTick = setInterval(() => {
    if (Date.now() >= endTs) return;
    for (let i = 0; i < msgsPerTick; i++) {
      sentCount++;
      const m = makeMockMessage({
        text: `.ping soak-${sentCount}`,
        jid:  `soak-${sentCount % 50}@s.whatsapp.net`,  // 50 unique chats
      });
      // Fire-and-forget; soak doesn't care about per-message timing
      handleMessage({ sock, m, commands: { resolve: () => null, all: () => [] }, store, logger: { debug() {}, info() {}, warn() {}, error() {} } })
        .catch(() => {});
    }
  }, 1000);
  fireTick.unref();

  // Per-minute sampling
  const sampleTick = setInterval(() => {
    const elapsedMin = Math.round((Date.now() - startTs) / 60_000);
    const mem = process.memoryUsage();
    const sample = {
      minute: elapsedMin,
      rssMB:        Math.round(mem.rss / 1e6),
      heapUsedMB:   Math.round(mem.heapUsed / 1e6),
      heapTotalMB:  Math.round(mem.heapTotal / 1e6),
      sentCount,
    };
    samples.push(sample);
    console.log(`[soak T+${elapsedMin}m] rss=${sample.rssMB}MB heap=${sample.heapUsedMB}/${sample.heapTotalMB}MB msgs=${sentCount}`);

    if (SNAP_EVERY_MIN > 0 && elapsedMin > 0 && elapsedMin % SNAP_EVERY_MIN === 0) {
      const snapPath = path.join(OUT_DIR, `heap-T${elapsedMin}.heapsnapshot`);
      console.log(`[soak] writing heap snapshot → ${snapPath}`);
      v8.writeHeapSnapshot(snapPath);
    }
  }, 60_000);
  sampleTick.unref();

  // Finish
  setTimeout(async () => {
    clearInterval(fireTick);
    clearInterval(sampleTick);
    try { await store.close?.(); } catch {}

    fs.writeFileSync(
      path.join(OUT_DIR, 'report.json'),
      JSON.stringify({ durationMin: DURATION_MIN, ratePerMin: RATE_PER_MIN, samples }, null, 2),
    );

    // Summary
    const first = samples[0];
    const last  = samples[samples.length - 1];
    const heapGrowth = last ? last.heapUsedMB - (first?.heapUsedMB || 0) : 0;
    const rssGrowth  = last ? last.rssMB - (first?.rssMB || 0) : 0;
    const verdict = heapGrowth > 50
      ? '❌ FAILED  — heap grew by more than 50 MB; likely a leak'
      : heapGrowth > 20
        ? '⚠️  WARN    — heap grew by 20-50 MB; investigate'
        : '✓ PASSED  — heap stable';

    const summary = [
      `Soak summary (${new Date().toISOString()})`,
      `Duration : ${DURATION_MIN} min`,
      `Rate     : ${RATE_PER_MIN} msgs/min`,
      `Sent     : ${sentCount} synthetic messages`,
      `RSS  Δ   : ${rssGrowth >= 0 ? '+' : ''}${rssGrowth} MB  (${first?.rssMB} → ${last?.rssMB})`,
      `Heap Δ   : ${heapGrowth >= 0 ? '+' : ''}${heapGrowth} MB  (${first?.heapUsedMB} → ${last?.heapUsedMB})`,
      `Verdict  : ${verdict}`,
    ].join('\n');
    fs.writeFileSync(path.join(OUT_DIR, 'summary.txt'), summary);
    console.log('\n' + summary);
    process.exit(0);
  }, DURATION_MIN * 60 * 1000 + 5000);
}

run().catch((err) => {
  console.error('[soak] fatal:', err);
  process.exit(1);
});