#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * One-shot script: add a SPDX-style AGPL header to every .js file we own.
 * Idempotent — re-running is safe.
 *
 *   node scripts/add-license-headers.js           # default: src/, scripts/
 *   node scripts/add-license-headers.js --check   # CI mode: exit 1 if any missing
 */
const fs   = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = ['src', 'scripts'].map((d) => path.join(ROOT, d));
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'commands']);
const EXCLUDE_FILES = new Set(['src/config.js']);   // user data, not our code
const HEADER_MARKER = '@license AGPL-3.0';
const HEADER = `/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details. ${HEADER_MARKER}
 *
 * You should have received a copy of the GNU AGPL along with this program.
 * If not, see <https://www.gnu.org/licenses/>.
 */
`;

const SHORT_HEADER_MARKER = HEADER_MARKER;
const SHORT_HEADER = `/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. ${SHORT_HEADER_MARKER}
 */
`;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXCLUDE_FILES.has(path.relative(ROOT, p))) continue;
    else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function hasHeader(content) {
  // Accept either the long form (with @license marker) OR the short form
  // we used in some early files. Both are valid AGPL headers.
  return content.includes(SHORT_HEADER_MARKER) ||
         content.includes('Licensed under the GNU AGPL-3.0-or-later. See LICENSE.');
}

function addHeader(file, content, useShort) {
  // Preserve shebang if present
  let shebang = '';
  let body    = content;
  if (body.startsWith('#!')) {
    const nl = body.indexOf('\n');
    shebang = body.slice(0, nl + 1);
    body    = body.slice(nl + 1);
  }
  return shebang + (useShort ? SHORT_HEADER : HEADER) + body;
}

function main() {
  const check = process.argv.includes('--check');
  const files = TARGETS.flatMap((d) => walk(d));
  let missing = 0, patched = 0;

  for (const f of files) {
    const c = fs.readFileSync(f, 'utf8');
    if (hasHeader(c)) continue;
    missing++;
    if (check) {
      console.error(`missing header: ${path.relative(ROOT, f)}`);
    } else {
      const useShort = c.length > 4000;     // long files get the short header
      fs.writeFileSync(f, addHeader(f, c, useShort));
      patched++;
      console.log(`✅ patched: ${path.relative(ROOT, f)}`);
    }
  }

  if (check && missing > 0) {
    console.error(`\n❌ ${missing} file(s) missing AGPL header. Run: node scripts/add-license-headers.js`);
    process.exit(1);
  }
  console.log(check ? `✅ all ${files.length} files have headers` : `done: ${patched} patched, ${files.length - patched} already OK`);
}

main();
