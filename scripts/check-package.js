#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { sensitiveFile, findHits } = require('./scan-secrets');

function checkArchive(archive) {
  const files = execFileSync('tar', ['-tzf', archive], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
    .trim()
    .split('\n');
  for (const file of files) {
    if (!file.startsWith('package/') || file.split('/').includes('..'))
      throw new Error('Unsafe archive path');
    if (sensitiveFile(file) || /\.(?:tar\.gz(?:\.enc)?|tgz)$/.test(file))
      throw new Error('Credential/backup material in package');
    if (
      /\/(?:creds\.json|config\.js|[^/]+\.db(?:-[^/]*)?)$|\/(?:@session|node_modules|data)\//.test(
        file,
      )
    )
      throw new Error('Runtime credentials/data in package');
  }
  // Scan distributable source AND generated frontend text, which is ignored
  // by the normal worktree scan. Never include matched values in gate output.
  for (const file of files) {
    if (!/\.(?:[cm]?js|jsx|tsx?|json|html|css|md|txt|ya?ml)$/.test(file)) continue;
    const content = execFileSync('tar', ['-xOzf', archive, file], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (findHits(content).length) throw new Error(`Credential content in package: ${file}`);
  }
  const required = [
    'package/package.json',
    'package/scripts/cli.js',
    'package/src/config.example.js',
    'package/src/dashboard/react/index.html',
    'package/dashboard/package.json',
    'package/dashboard/package-lock.json',
    'package/dashboard/tsconfig.app.json',
    'package/dashboard/tsconfig.node.json',
    'package/dashboard/tsconfig.json',
    'package/dashboard/vite.config.ts',
    'package/dashboard/src/main.tsx',
  ];
  for (const file of required)
    if (!files.includes(file)) throw new Error(`Package missing required file: ${file}`);
  const pkg = JSON.parse(
    execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }),
  );
  if (pkg.bin?.echofox !== 'scripts/cli.js') throw new Error('Missing echofox CLI mapping');
  if (!files.some((file) => /^package\/src\/dashboard\/react\/assets\/.+\.js$/.test(file)))
    throw new Error('Missing built dashboard JavaScript');
  return { files: files.length, version: pkg.version };
}

if (require.main === module) {
  try {
    const archive = path.resolve(process.argv[2] || '');
    if (!process.argv[2] || !fs.statSync(archive).isFile())
      throw new Error('Pass the actual npm .tgz archive');
    const result = checkArchive(archive);
    console.log(
      `Package verified: ${result.version}, ${result.files} files, CLI and built frontend present`,
    );
  } catch (error) {
    console.error(`Package check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { checkArchive };
