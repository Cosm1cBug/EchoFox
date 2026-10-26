#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const production =
  process.env.NODE_ENV === 'production' ||
  String(process.env.npm_config_omit || '')
    .split(/[,\s]+/)
    .includes('dev');
if (!fs.existsSync(path.join(root, '.git')) || production) {
  console.log('Git hooks not installed: non-Git/runtime-only installation.');
} else {
  // A real development-hook failure must not be hidden behind `|| true`.
  const bin = path.join(path.dirname(require.resolve('husky')), 'bin.js');
  const result = spawnSync(process.execPath, [bin], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
