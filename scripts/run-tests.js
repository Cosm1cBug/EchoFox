#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Cross-platform test runner (v1.4.3).
 *
 *   node scripts/run-tests.js               # all *.test.js under src/
 *   node scripts/run-tests.js src/services  # only one subtree
 *
 * Why this exists:
 *   - `node --test src/**\/*.test.js src/commands/__tests__/*.test.js`
 *     in package.json was broken on Linux (bash globstar disabled by
 *     default), macOS (same), and Windows PowerShell (no glob expansion
 *     at all). Node.js itself does NOT expand globs — the previous script
 *     only worked by accident on some shells.
 *   - Node 22 added `--test-glob` but the CI matrix targets Node 20 too.
 *   - `node --test <dir>` walks every .js file as a potential test file,
 *     which doesn't match the `*.test.js` convention.
 *
 *   This tiny script does a pure-Node recursive walk for *.test.js files,
 *   then spawns `node --test <file1> <file2> ...` with the explicit list.
 *   Works identically on every shell + every Node.js version we support.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'build']);

function findTests(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }

  for (const e of entries) {
    if (EXCLUDE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findTests(p, out);
    else if (e.isFile() && e.name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

const rootsArgs = process.argv.slice(2);
const roots = rootsArgs.length
  ? rootsArgs.map((r) => path.resolve(ROOT, r))
  : [path.join(ROOT, 'src')];

const files = [];
for (const r of roots) findTests(r, files);
files.sort();

if (files.length === 0) {
  console.error(
    'run-tests.js: no *.test.js files found under',
    roots.map((r) => path.relative(ROOT, r)).join(', '),
  );
  process.exit(1);
}

console.log(`run-tests.js: running ${files.length} test file(s)`);

const nodeArgs = ['--test', ...files];
const child = spawn(process.execPath, nodeArgs, {
  stdio: 'inherit',
  cwd: ROOT,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
