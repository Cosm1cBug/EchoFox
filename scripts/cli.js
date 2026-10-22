#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const args = process.argv.slice(2);
const at = args.indexOf('--config');
if (at >= 0) {
  if (!args[at + 1] || args[at + 1].startsWith('--')) {
    console.error('--config requires a configuration file path');
    process.exit(1);
  }
  process.env.ECHOFOX_CONFIG = args[at + 1];
  args.splice(at, 2);
}
const command = args[0] || 'start';
if (args.length > 1) {
  console.error('Unexpected arguments. Run echofox --help.');
  process.exit(1);
}
if (['--help', '-h', 'help'].includes(command)) {
  console.log(
    'Usage: echofox [start|config:check|--version] [--config /path/to/config.cjs]\nValidate first; start opens WhatsApp/provider/network connections.',
  );
} else if (['--version', '-v'].includes(command)) {
  console.log(require('../package.json').version);
} else if (command === 'config:check') {
  require('./check-config');
} else if (command === 'start') {
  require('../src/core/bootstrap');
} else {
  console.error('Unknown command. Run echofox --help.');
  process.exitCode = 1;
}
