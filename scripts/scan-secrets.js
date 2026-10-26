#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PATTERNS = [
  ['AWS key', /AKIA[0-9A-Z]{16}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/],
  ['npm token', /npm_[A-Za-z0-9]{30,}/],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['Google key', /AIza[0-9A-Za-z_-]{35}/],
  ['AI API key', /sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{30,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['credential URL', /https?:\/\/[^\s/@]+:[^\s/@]+@/],
];
const HASH = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const ZERO = /^0+$/;
const sensitiveFile = (file) =>
  /(^|\/)\.env(?:\..+)?$|(^|\/)(?:creds|pre-key-\d+|session-.+|sender-key-.+|app-state-sync-key-.+)\.json$|\.pem$|(^|\/)id_rsa(?:$|\.)|(^|\/)auth_info|(^|\/)session\.json$/i.test(
    file,
  ) && !/(^|\/)\.env\.example$/.test(file);

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function findHits(text) {
  return PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}
function scan({ cwd = process.cwd(), base, pushes = null, remote = 'origin' } = {}) {
  const hits = [];
  const commits = new Set();
  const addRange = (local, old) => {
    if (!HASH.test(local) || (old && !HASH.test(old))) throw new Error('Invalid push object ID');
    if (ZERO.test(local)) return; // deletion sends no new contents
    if (old && !ZERO.test(old)) {
      // A missing remote base is an error: never silently scan only HEAD.
      for (const commit of git(['rev-list', `${old}..${local}`], cwd)
        .trim()
        .split('\n')
        .filter(Boolean))
        commits.add(commit);
    } else {
      for (const commit of git(['rev-list', local, '--not', `--remotes=${remote}`], cwd)
        .trim()
        .split('\n')
        .filter(Boolean))
        commits.add(commit);
    }
  };
  if (pushes) {
    for (const line of pushes.trim().split('\n').filter(Boolean)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 4) throw new Error('Malformed pre-push input');
      addRange(parts[1], parts[3]);
      if (!ZERO.test(parts[1])) {
        const object = git(['cat-file', '-p', parts[1]], cwd);
        // Includes annotated tag messages, without printing the message.
        for (const label of findHits(object))
          hits.push({ source: 'push-object', object: parts[1], pattern: label });
      }
    }
  } else {
    const head = git(['rev-parse', 'HEAD'], cwd).trim();
    if (!base) {
      try {
        base = git(['rev-parse', '--verify', '@{upstream}'], cwd).trim();
      } catch {
        try {
          base = git(['rev-parse', '--verify', 'refs/remotes/origin/main'], cwd).trim();
        } catch {
          base = null;
        }
      }
    }
    addRange(head, base);
  }
  for (const commit of commits) {
    const changedFiles = git(
      [
        'diff-tree',
        '--root',
        '-m',
        '--no-commit-id',
        '--name-only',
        '--diff-filter=ACMRT',
        '-r',
        '-z',
        commit,
      ],
      cwd,
    )
      .split('\0')
      .filter(Boolean);
    for (const file of new Set(changedFiles)) {
      if (sensitiveFile(file)) hits.push({ source: 'outgoing-sensitive-filename', commit, file });
      // Full final blobs catch binary data and merge resolutions, not only
      // text additions printed by Git's default (possibly combined) patch.
      for (const label of findHits(git(['show', `${commit}:${file}`], cwd)))
        hits.push({ source: 'outgoing-blob', commit, file, pattern: label });
    }
    for (const label of findHits(git(['log', '-1', '--format=%B', commit], cwd)))
      hits.push({ source: 'commit-message', commit, pattern: label });
    const patch = git(['show', '--no-ext-diff', '--format=', '--unified=0', commit, '--'], cwd);
    let file = '(patch)';
    let line = 0;
    for (const content of patch.split('\n')) {
      if (content.startsWith('+++ b/')) file = content.slice(6);
      if (content.startsWith('@@')) {
        line = Number(/\+(\d+)/.exec(content)?.[1]) || 0;
        continue;
      }
      if (content.startsWith('+') && !content.startsWith('+++')) {
        for (const label of findHits(content.slice(1)))
          hits.push({ source: 'outgoing-commit', commit, file, line, pattern: label });
        line++;
      }
    }
  }
  // Scan working contents, including untracked additions, not just one diff.
  // Ignored runtime credentials remain out of scope unless already tracked.
  const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd)
    .split('\0')
    .filter(Boolean);
  for (const file of files) {
    if (sensitiveFile(file)) hits.push({ source: 'sensitive-filename', file });
    const full = path.resolve(cwd, file);
    if (!fs.existsSync(full)) continue; // tracked deletion
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink() || !stat.isFile()) continue; // never follow links out of the checkout
    if (stat.size > 10 * 1024 * 1024)
      throw new Error('File exceeds scanner size limit; explicit review required');
    const contents = fs.readFileSync(full);
    if (contents.includes(0)) {
      for (const label of findHits(contents.toString('utf8')))
        hits.push({ source: 'working-binary', file, pattern: label });
      continue;
    }
    contents
      .toString('utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const label of findHits(line))
          hits.push({ source: 'working-tree', file, line: index + 1, pattern: label });
      });
  }
  return { hits, commits: commits.size, files: files.length };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const prePush = args.includes('--pre-push');
    const baseAt = args.indexOf('--base');
    const result = scan({
      base: baseAt >= 0 ? args[baseAt + 1] : undefined,
      pushes: prePush ? fs.readFileSync(0, 'utf8') : null,
      remote: prePush ? args[args.indexOf('--pre-push') + 1] || 'origin' : 'origin',
    });
    console.log(`Secret scan: ${result.commits} outgoing commits; ${result.files} working files`);
    if (result.hits.length) {
      // Locations/categories ONLY. Never echo matched credentials into logs.
      for (const hit of result.hits.slice(0, 30)) console.error(JSON.stringify(hit));
      console.error(
        'Potential secrets detected. Do not push; review locally and rotate genuine exposed credentials.',
      );
      process.exitCode = 1;
    }
  } catch {
    console.error(
      'Secret scan could not complete — gate failed. Check Git history/refs and scanner limits.',
    );
    process.exitCode = 2;
  }
}

module.exports = { scan, findHits, sensitiveFile };
