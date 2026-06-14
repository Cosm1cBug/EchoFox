#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Build the React dashboard and copy the output into
 *   src/dashboard/react/
 * so the express server can serve it as static assets.
 *
 *   Cross-platform (Windows + macOS + Linux): no shell commands.
 *   Used by:
 *     • `npm run build:dashboard`              (manual)
 *     • startDashboard() at boot-time if missing  (auto, see server.js)
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DASH_SRC = path.join(ROOT, 'dashboard');
const DASH_DIST = path.join(DASH_SRC, 'dist');
const SERVE_DIR = path.join(ROOT, 'src', 'dashboard', 'react');

function log(msg) {
  console.log(`[build-dashboard] ${msg}`);
}

function fail(msg, code = 1) {
  console.error(`[build-dashboard] ERROR: ${msg}`);
  process.exit(code);
}

if (!fs.existsSync(path.join(DASH_SRC, 'package.json'))) {
  fail(`dashboard/ project not found at ${DASH_SRC}`);
}

// ─── 1. Ensure dashboard deps are installed ──────────────────────────────
if (!fs.existsSync(path.join(DASH_SRC, 'node_modules'))) {
  log('installing dashboard deps (one-time)…');
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: DASH_SRC,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (install.status !== 0) fail('npm install in dashboard/ failed', install.status);
}

// ─── 2. Run vite build ───────────────────────────────────────────────────
log('running vite build…');
const build = spawnSync('npx', ['vite', 'build'], {
  cwd: DASH_SRC,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (build.status !== 0) fail('vite build failed', build.status);

// ─── 3. Copy dist/* → src/dashboard/react/ ───────────────────────────────
if (!fs.existsSync(DASH_DIST)) fail(`expected output at ${DASH_DIST}`);

// Wipe and recreate target
fs.rmSync(SERVE_DIR, { recursive: true, force: true });
fs.mkdirSync(SERVE_DIR, { recursive: true });

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
copyDir(DASH_DIST, SERVE_DIR);

log(`✓ dashboard built and copied to ${path.relative(ROOT, SERVE_DIR)}`);
