/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Command contract tests.
 *
 *   Run:  node --test src/commands/__tests__/contract.test.js
 *
 * Every command file under src/commands/<category>/ must export an object
 * matching the CommandRegistry contract. This test catches:
 *   • syntax errors / accidental ES-module exports
 *   • missing `name` or `start`
 *   • malformed alias/requires arrays
 *   • duplicate names or alias collisions across the whole tree
 *
 * Failures fail the test suite (and in M4 will fail the CI build).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..'); // src/commands/
const EXCLUDE = new Set(['__tests__', '_disabled']);
const categories = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !EXCLUDE.has(d.name) && !d.name.startsWith('.'))
  .map((d) => d.name);

const allCommands = []; // { file, mod, cat }

for (const cat of categories) {
  const dir = path.join(ROOT, cat);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const full = path.join(dir, file);

    test(`[${cat}] ${file} — parses + exports a command object`, () => {
      let mod;
      try {
        mod = require(full);
      } catch (e) {
        assert.fail(`require() threw: ${e.message}`);
      }

      assert.equal(typeof mod, 'object', 'must export an object (not a function)');
      assert.equal(typeof mod.name, 'string', '`name` must be a string');
      assert.ok(mod.name.length > 0, '`name` must not be empty');
      assert.equal(typeof mod.start, 'function', '`start` must be a function');

      if ('alias' in mod) {
        assert.ok(Array.isArray(mod.alias), '`alias` must be an array');
        mod.alias.forEach((a) => assert.equal(typeof a, 'string', 'each alias must be a string'));
      }
      if ('requires' in mod) {
        assert.ok(
          Array.isArray(mod.requires),
          '`requires` must be an array of dotted config paths',
        );
      }
      if ('desc' in mod) assert.equal(typeof mod.desc, 'string');
      if ('category' in mod) assert.equal(typeof mod.category, 'string');
      if ('admin' in mod) assert.equal(typeof mod.admin, 'boolean');
      if ('group' in mod) assert.equal(typeof mod.group, 'boolean');
      if ('needsMetadata' in mod) assert.equal(typeof mod.needsMetadata, 'boolean');
      if ('noLimit' in mod) assert.equal(typeof mod.noLimit, 'boolean');
      if ('cooldown' in mod) assert.equal(typeof mod.cooldown, 'number');
      if ('timeout' in mod) assert.equal(typeof mod.timeout, 'number');

      allCommands.push({ file, mod, cat });
    });
  }
}

// ─── Global cross-checks (after individual contracts pass) ────────────────
test('no duplicate command names across the tree', () => {
  const seen = new Map();
  for (const { mod, cat, file } of allCommands) {
    const lower = mod.name.toLowerCase();
    if (seen.has(lower)) {
      const prev = seen.get(lower);
      assert.fail(`duplicate name "${mod.name}" in ${cat}/${file} and ${prev.cat}/${prev.file}`);
    }
    seen.set(lower, { cat, file });
  }
});

test('no alias collisions across the tree', () => {
  const seen = new Map();
  for (const { mod, cat, file } of allCommands) {
    for (const a of mod.alias || []) {
      const lower = a.toLowerCase();
      if (seen.has(lower)) {
        const prev = seen.get(lower);
        assert.fail(`alias "${a}" used by ${cat}/${file} AND ${prev.cat}/${prev.file}`);
      }
      seen.set(lower, { cat, file });
    }
  }
});

test("no alias shadowing another command's primary name", () => {
  const names = new Set(allCommands.map((c) => c.mod.name.toLowerCase()));
  for (const { mod, cat, file } of allCommands) {
    for (const a of mod.alias || []) {
      if (names.has(a.toLowerCase())) {
        assert.fail(`alias "${a}" in ${cat}/${file} shadows another command's primary name`);
      }
    }
  }
});

test('every `requires` entry is a dotted config path (no leading dot)', () => {
  for (const { mod, cat, file } of allCommands) {
    for (const r of mod.requires || []) {
      assert.match(
        r,
        /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/,
        `${cat}/${file}: requires entry "${r}" is not a valid dotted path`,
      );
    }
  }
});
