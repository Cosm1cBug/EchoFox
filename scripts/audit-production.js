#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseAudit } = require('./check-audit');
let failed = false;
for (const project of ['.', 'dashboard']) {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: path.resolve(__dirname, '..', project),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  try {
    if (result.error) throw result.error;
    const counts = parseAudit(result.stdout, result.status);
    console.log(
      `${project}: ${counts.highCritical} high/critical; ${counts.total} total production findings`,
    );
    if (counts.highCritical) failed = true;
  } catch {
    console.error(`${project}: audit unavailable/malformed — not a clean result`);
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
