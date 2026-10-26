/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { parseAudit } = require('../../../scripts/check-audit');
const { scan } = require('../../../scripts/scan-secrets');
const { checkLicense } = require('../../../scripts/check-license');
const root = path.resolve(__dirname, '../../..');

const report = (high = 0) =>
  JSON.stringify({
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical: 0, total: high } },
  });

test('audit parser: valid clean/finding reports are distinct from malformed, registry and execution errors', () => {
  assert.deepEqual(parseAudit(report(), 0), { highCritical: 0, total: 0 });
  assert.deepEqual(parseAudit(report(2), 1), { highCritical: 2, total: 2 });
  for (const [text, status] of [
    ['', 0],
    ['not-json', 1],
    ['{"error":{"code":"E401"}}', 1],
    ['{}', 0],
    [report(), 2],
    ['{"metadata":{"vulnerabilities":{"high":0,"critical":0}}}', 0],
  ]) {
    assert.throws(() => parseAudit(text, status));
  }
});

test('audit CLI: malformed/error JSON never exits clean or prints raw registry credentials', () => {
  for (const input of ['not-json', '{"error":{"message":"SECRET_CANARY"}}']) {
    const run = spawnSync(process.execPath, [path.join(root, 'scripts/check-audit.js'), '1'], {
      input,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(run.status, 2);
    assert.ok(!(run.stdout + run.stderr).includes('SECRET_CANARY'));
  }
  const finding = spawnSync(process.execPath, [path.join(root, 'scripts/check-audit.js'), '1'], {
    input: report(1),
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(finding.status, 1);
});

function repository(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echofox-gate-fixture-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet', '--initial-branch=arena/85db23c3-echofox');
  git('config', 'user.name', 'Gate fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(cwd, 'readme.txt'), 'initial');
  git('add', '.');
  git('commit', '--quiet', '-m', 'initial');
  return { cwd, git, base: git('rev-parse', 'HEAD') };
}

test('secret gate: scans ALL outgoing commits, including a credential removed before HEAD', (t) => {
  const { cwd, git, base } = repository(t);
  const secret = ['gh', 'p_', 'A'.repeat(30)].join('');
  fs.writeFileSync(path.join(cwd, 'transient.txt'), secret);
  git('add', '.');
  git('commit', '--quiet', '-m', 'introduce fixture');
  fs.unlinkSync(path.join(cwd, 'transient.txt'));
  git('add', '-A');
  git('commit', '--quiet', '-m', 'remove fixture');
  const result = scan({ cwd, base });
  assert.equal(result.commits, 2);
  assert.ok(
    result.hits.some((hit) => hit.source === 'outgoing-commit' && hit.file === 'transient.txt'),
  );
  const cli = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/scan-secrets.js'), '--base', base],
    { cwd, encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(cli.status, 1);
  assert.ok(
    !(cli.stdout + cli.stderr).includes(secret),
    'gate logs locations, never matched values',
  );
});

test('secret gate: actual pre-push spans and new-branch spans include every outgoing commit', (t) => {
  const { cwd, git, base } = repository(t);
  fs.writeFileSync(path.join(cwd, 'added.txt'), ['npm', '_', 'B'.repeat(35)].join(''));
  git('add', '.');
  git('commit', '--quiet', '-m', 'add fixture');
  const head = git('rev-parse', 'HEAD');
  const existing = scan({
    cwd,
    pushes: `refs/heads/arena/85db23c3-echofox ${head} refs/heads/arena/85db23c3-echofox ${base}\n`,
  });
  assert.equal(existing.commits, 1);
  assert.ok(existing.hits.length > 0);
  const fresh = scan({
    cwd,
    pushes: `refs/heads/arena/85db23c3-echofox ${head} refs/heads/arena/85db23c3-echofox ${'0'.repeat(40)}\n`,
  });
  assert.equal(fresh.commits, 2);
  assert.ok(fresh.hits.length > 0);
});

test('secret gate: untracked additions and sensitive filenames are covered; invalid ranges fail closed', (t) => {
  const { cwd, base } = repository(t);
  fs.writeFileSync(path.join(cwd, 'creds.json'), '{}');
  assert.ok(scan({ cwd, base }).hits.some((hit) => hit.source === 'sensitive-filename'));
  assert.throws(() => scan({ cwd, base: 'f'.repeat(40) }));
});

test('license gate: conflicting published declarations block release without selecting a replacement', () => {
  assert.ok(
    checkLicense({ license: 'AGPL-3.0-or-later' }, 'MIT License', 'AGPL-3.0-or-later').length > 0,
  );
  assert.deepEqual(
    checkLicense(
      { license: 'AGPL-3.0-or-later' },
      'GNU AFFERO GENERAL PUBLIC LICENSE',
      'AGPL-3.0-or-later',
    ),
    [],
  );
  const current = spawnSync(process.execPath, [path.join(root, 'scripts/check-license.js')], {
    encoding: 'utf8',
    timeout: 5000,
  });
  const issues = checkLicense(
    require('../../../package.json'),
    fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'),
    fs.readFileSync(path.join(root, 'NOTICE'), 'utf8'),
  );
  assert.equal(current.status, issues.length ? 1 : 0);
  if (issues.length) assert.match(current.stderr, /owner\/contributor provenance review required/);
});

test('CLI: version/help/config validation do not start supervisor, pairing or workers', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/cli.js'), '--version'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), require('../../../package.json').version);
  const invalid = spawnSync(process.execPath, [path.join(root, 'scripts/cli.js'), '--config'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(invalid.status, 1);
  assert.ok(!run.stdout.includes('supervisor'));
});

test('monitoring configuration keeps auth on the scrape job and uses mounted password files', () => {
  const root = path.resolve(__dirname, '../../..');
  const prometheus = fs.readFileSync(path.join(root, 'docker/prometheus/prometheus.yml'), 'utf8');
  const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  // A structural regression guard, not a substitute for promtool / live scrapes.
  assert.match(prometheus, /^ {4}basic_auth:\s*$/m);
  assert.match(prometheus, /password_file: \/run\/secrets\/metrics_dashboard_password/);
  assert.doesNotMatch(
    prometheus
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n'),
    /\$\{/,
  );
  assert.match(
    compose,
    /GF_SECURITY_ADMIN_PASSWORD__FILE:\s+\/run\/secrets\/grafana_admin_password/,
  );
  assert.doesNotMatch(compose, /GF_SECURITY_ADMIN_PASSWORD:\s+.*changeme/);
  assert.match(compose, /127\.0\.0\.1:3002:3000/);
});

test('artifact gate checks built/frontend inputs, runtime files and generated bundle credentials on the actual tar', (t) => {
  const { checkArchive } = require('../../../scripts/check-package');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echofox-package-fixture-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const entries = [
    'package.json',
    'scripts/cli.js',
    'src/config.example.js',
    'src/dashboard/react/index.html',
    'src/dashboard/react/assets/index.js',
    'dashboard/package.json',
    'dashboard/package-lock.json',
    'dashboard/tsconfig.app.json',
    'dashboard/tsconfig.node.json',
    'dashboard/tsconfig.json',
    'dashboard/vite.config.ts',
    'dashboard/src/main.tsx',
  ];
  const write = (file, content = '') => {
    const full = path.join(cwd, 'package', file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  for (const file of entries) write(file);
  write('package.json', JSON.stringify({ version: '0.0.0', bin: { echofox: 'scripts/cli.js' } }));
  const archive = path.join(cwd, 'fixture.tgz');
  const pack = () => {
    execFileSync('tar', ['-czf', archive, 'package'], { cwd });
    return archive;
  };
  assert.equal(checkArchive(pack()).version, '0.0.0');
  const secret = ['sk', '-', 'X'.repeat(35)].join('');
  write('src/dashboard/react/assets/index.js', secret);
  assert.throws(
    () => checkArchive(pack()),
    (error) => /Credential content/.test(error.message) && !error.message.includes(secret),
  );
  write('src/dashboard/react/assets/index.js');
  write('src/nested/creds.json', '{}');
  assert.throws(() => checkArchive(pack()), /Credential/);
  fs.rmSync(path.join(cwd, 'package/src/nested'), { recursive: true });
  fs.rmSync(path.join(cwd, 'package/dashboard/tsconfig.app.json'));
  assert.throws(() => checkArchive(pack()), /missing required file/);
});

test('secret gate: merge-resolution blobs and binary files cannot hide transient credentials', (t) => {
  const { cwd, git, base } = repository(t);
  git('commit', '--quiet', '--allow-empty', '-m', 'left');
  const left = git('rev-parse', 'HEAD');
  const right = git('commit-tree', `${base}^{tree}`, '-p', base, '-m', 'right');
  const secret = ['sk', '-', 'M'.repeat(35)].join('');
  fs.writeFileSync(
    path.join(cwd, 'merge.bin'),
    Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(secret)]),
  );
  assert.ok(scan({ cwd, base }).hits.some((hit) => hit.source === 'working-binary'));
  git('add', 'merge.bin');
  const merge = git(
    'commit-tree',
    git('write-tree'),
    '-p',
    left,
    '-p',
    right,
    '-m',
    'merge fixture',
  );
  fs.unlinkSync(path.join(cwd, 'merge.bin'));
  const result = scan({
    cwd,
    pushes: `refs/heads/arena/85db23c3-echofox ${merge} refs/heads/arena/85db23c3-echofox ${base}\n`,
  });
  assert.equal(result.commits, 3);
  assert.ok(
    result.hits.some(
      (hit) => hit.source === 'outgoing-blob' && hit.commit === merge && hit.file === 'merge.bin',
    ),
  );
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('secret gate: annotated push-object messages are inspected without logging credentials', (t) => {
  const { cwd, base } = repository(t);
  const secret = ['npm', '_', 'T'.repeat(35)].join('');
  const object = `object ${base}\ntype commit\ntag fixture\ntagger Gate Fixture <fixture@example.invalid> 1760000000 +0000\n\n${secret}\n`;
  const tag = execFileSync('git', ['mktag'], { cwd, input: object, encoding: 'utf8' }).trim();
  const result = scan({
    cwd,
    pushes: `refs/tags/fixture ${tag} refs/tags/fixture ${'0'.repeat(40)}\n`,
  });
  assert.ok(result.hits.some((hit) => hit.source === 'push-object'));
  assert.ok(!JSON.stringify(result).includes(secret));
});
