#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Capture a v8 heap snapshot to disk.
 *
 *   $ node scripts/heap-snapshot.js [--out=<path>]
 *
 *   Default output path:
 *     ./snapshots/heap-<ISO-timestamp>.heapsnapshot
 *
 *   Open the resulting .heapsnapshot file in Chrome DevTools:
 *     1. Open chrome://inspect
 *     2. Click "Open dedicated DevTools for Node"
 *     3. Memory tab → Load → pick your file
 *
 *   For an automated growth-over-time check, use scripts/heap-diff.js
 *   against two snapshots taken N hours apart.
 */

const fs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');

const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith('--out='));
const SNAPSHOT_DIR = path.join(process.cwd(), 'snapshots');

if (!outArg) {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = outArg
  ? outArg.slice('--out='.length)
  : path.join(SNAPSHOT_DIR, `heap-${ts}.heapsnapshot`);

console.log(`[heap-snapshot] writing → ${outPath}`);
const start = Date.now();
const written = v8.writeHeapSnapshot(outPath);
const ms = Date.now() - start;
const sizeBytes = fs.statSync(written).size;
console.log(`[heap-snapshot] ✓ written in ${ms}ms · ${(sizeBytes / 1e6).toFixed(1)} MB`);
console.log(`[heap-snapshot] open in Chrome DevTools (chrome://inspect → Memory → Load)`);
