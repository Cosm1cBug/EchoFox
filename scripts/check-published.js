#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const pkg = require('../package.json');
const result = spawnSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
try {
  if (result.error) throw result.error;
  const data = JSON.parse(result.stdout);
  if (result.status === 0 && data === pkg.version) console.log('already=true');
  else if (result.status !== 0 && data.error?.code === 'E404') console.log('already=false');
  else throw new Error('Unrecognized registry result');
} catch {
  console.error(
    'Cannot determine registry version state; network/auth/policy errors are not "unpublished".',
  );
  process.exitCode = 1;
}
