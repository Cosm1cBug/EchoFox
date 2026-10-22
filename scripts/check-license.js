#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function checkLicense(pkg, text, notice) {
  const declared = pkg.license;
  const actual = /GNU AFFERO GENERAL PUBLIC LICENSE/i.test(text)
    ? 'AGPL-3.0-or-later'
    : /MIT License/.test(text)
      ? 'MIT'
      : 'unrecognized';
  const issues = [];
  if (actual !== declared)
    issues.push(`package.json declares ${declared}; root LICENSE identifies ${actual}`);
  if (/AGPL-3\.0|Affero General Public License/i.test(notice) && !String(declared).includes('AGPL'))
    issues.push('NOTICE and package license disagree');
  return issues;
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const issues = checkLicense(
    require('../package.json'),
    fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'),
    fs.readFileSync(path.join(root, 'NOTICE'), 'utf8'),
  );
  if (issues.length) {
    for (const issue of issues) console.error(issue);
    console.error(
      'Release blocked: owner/contributor provenance review required. This check does not choose or rewrite a license.',
    );
    process.exitCode = 1;
  } else console.log('License declarations consistent (not a legal/provenance certification).');
}
module.exports = { checkLicense };
