#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Diff two v8 heap snapshots and report class-level retention deltas.
 *
 *   $ node scripts/heap-diff.js <before.heapsnapshot> <after.heapsnapshot>
 *
 *   Output: top classes by absolute retained-size growth, with %.
 *
 *   .heapsnapshot files are JSON with a known schema (Chrome DevTools
 *   format). We parse the strings + nodes arrays, aggregate by node
 *   type/name, and diff the totals. Not a perfect substitute for
 *   DevTools' allocation timeline, but catches monotonic growth in
 *   typical "leaky cache" or "unbounded array" patterns.
 */

const fs = require('node:fs');

function fail(msg, code = 1) { console.error(`[heap-diff] ERROR: ${msg}`); process.exit(code); }

if (process.argv.length < 4) {
  fail('usage: heap-diff.js <before.heapsnapshot> <after.heapsnapshot>');
}

const [, , beforePath, afterPath] = process.argv;
for (const p of [beforePath, afterPath]) {
  if (!fs.existsSync(p)) fail(`file not found: ${p}`);
}

function loadSnapshot(p) {
  console.log(`[heap-diff] loading ${p} (${(fs.statSync(p).size / 1e6).toFixed(1)} MB)…`);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const { snapshot, nodes, strings } = raw;
  const { node_fields, node_types } = snapshot.meta;
  const fieldCount = node_fields.length;
  const nameIdx = node_fields.indexOf('name');
  const typeIdx = node_fields.indexOf('type');
  const sizeIdx = node_fields.indexOf('self_size');
  const typeNames = Array.isArray(node_types[0]) ? node_types[0] : node_types;
  const byName = new Map();   // name → { count, totalSize }
  for (let i = 0; i < nodes.length; i += fieldCount) {
    const type  = typeNames[nodes[i + typeIdx]];
    const name  = strings[nodes[i + nameIdx]];
    const size  = nodes[i + sizeIdx];
    // Concatenate type+name so we don't lump together different kinds
    const key = `${type}:${name}`;
    let row = byName.get(key);
    if (!row) { row = { count: 0, totalSize: 0 }; byName.set(key, row); }
    row.count++;
    row.totalSize += size;
  }
  return byName;
}

const before = loadSnapshot(beforePath);
const after  = loadSnapshot(afterPath);

const allKeys = new Set([...before.keys(), ...after.keys()]);
const deltas = [];
for (const k of allKeys) {
  const b = before.get(k) || { count: 0, totalSize: 0 };
  const a = after.get(k)  || { count: 0, totalSize: 0 };
  const deltaSize  = a.totalSize - b.totalSize;
  const deltaCount = a.count - b.count;
  if (deltaSize === 0 && deltaCount === 0) continue;
  deltas.push({ key: k, deltaSize, deltaCount, beforeSize: b.totalSize, afterSize: a.totalSize });
}
deltas.sort((x, y) => Math.abs(y.deltaSize) - Math.abs(x.deltaSize));

console.log('\n=== Top 30 class deltas (by abs retained-size change) ===');
console.log(`${'CLASS'.padEnd(45)}  ${'+Δ count'.padStart(10)}  ${'+Δ size'.padStart(14)}  ${'pct'.padStart(7)}`);
console.log('-'.repeat(85));
for (const d of deltas.slice(0, 30)) {
  const pct = d.beforeSize === 0
    ? (d.deltaSize > 0 ? '  NEW' : '   ?')
    : `${((d.deltaSize / d.beforeSize) * 100).toFixed(1)}%`;
  const sizeStr = d.deltaSize >= 0
    ? `+${(d.deltaSize / 1024).toFixed(1)} KB`
    : `${(d.deltaSize / 1024).toFixed(1)} KB`;
  console.log(`${d.key.slice(0, 45).padEnd(45)}  ${String(d.deltaCount).padStart(10)}  ${sizeStr.padStart(14)}  ${pct.padStart(7)}`);
}

const totalDelta = deltas.reduce((s, d) => s + d.deltaSize, 0);
console.log('-'.repeat(85));
console.log(`Total heap delta: ${(totalDelta / 1e6).toFixed(2)} MB`);
if (totalDelta > 50 * 1e6) {
  console.warn('\n⚠️  Heap grew by more than 50 MB between snapshots — review top classes above for suspect retainers.');
}