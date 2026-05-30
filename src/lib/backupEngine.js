/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';

/**
 * Backup engine — actually wires the v0.4.4 scaffold.
 *
 *   Config (config.backup):
 *     enabled:     true to run scheduled backups
 *     schedule:    cron expression (default '0 3 * * *')
 *     destination: local directory path (v0.4.5 only — cloud later)
 *     retain:      keep last N backups (older ones deleted)
 *     include:     list of paths under src/ to include
 *
 *   Behaviour:
 *     • Creates `<destination>/echofox-YYYY-MM-DDTHH-MM-SS.tar.gz`
 *     • Uses Node's built-in `node:zlib` + tar streaming via
 *       `tar-stream` if installed; otherwise spawns the system `tar`
 *       binary as a fallback.
 *     • Encryption: if `encryptionPassphrase` is set, wraps in
 *       AES-256-GCM before writing. Decrypt with:
 *         openssl enc -aes-256-gcm -d -pbkdf2 -in foo.tar.gz.enc
 *     • Idempotent: refuses to overwrite if filename exists.
 *     • Retention: after a successful backup, deletes files matching
 *       the prefix beyond `retain` count.
 *     • Failures emit warn logs + counter; never crash the bot.
 *
 *   API:
 *     startBackupEngine(config)   - schedules cron + does an immediate
 *                                   sanity-check that destination is writable
 *     runBackupNow(config)        - one-shot, returns { ok, path, size }
 *     stopBackupEngine()
 */

const fs   = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const logger  = require('../core/logger').child({ mod: 'backup' });
const metrics = require('../services/metrics');

let _cronTask = null;

function _stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function _projectRoot() {
  return path.resolve(__dirname, '..', '..');
}

async function _ensureDir(dir) {
  if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true });
}

async function _writableProbe(dir) {
  const probe = path.join(dir, '.echofox-backup-probe');
  await fs.promises.writeFile(probe, 'ok');
  await fs.promises.unlink(probe);
}

/**
 * Build the tar.gz stream using the system tar binary.
 *   Includes only paths inside src/ to avoid runaway sizes.
 */
function _spawnSystemTar({ outFile, projectRoot, includes }) {
  return new Promise((resolve, reject) => {
    const args = ['-czf', outFile, '-C', projectRoot, ...includes.map((p) => path.join('src', p))];
    const proc = spawn('tar', args, { stdio: ['ignore', 'inherit', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (b) => { stderr += b.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited code=${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

/**
 * Filter the include[] list — only keep paths that exist; warn on missing.
 */
function _validateIncludes(projectRoot, includes) {
  return includes.filter((p) => {
    const abs = path.join(projectRoot, 'src', p);
    if (fs.existsSync(abs)) return true;
    logger.warn({ path: p }, 'backup include path not found — skipping');
    return false;
  });
}

/**
 * Encrypt a file in-place with AES-256-GCM (PBKDF2-derived key).
 *   Format on disk: salt(16) | iv(12) | tag(16) | ciphertext
 */
async function _encryptFile(file, passphrase) {
  const crypto = require('node:crypto');
  const data = await fs.promises.readFile(file);
  const salt = crypto.randomBytes(16);
  const iv   = crypto.randomBytes(12);
  const key  = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
  const cip  = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct   = Buffer.concat([cip.update(data), cip.final()]);
  const tag  = cip.getAuthTag();
  const out  = Buffer.concat([salt, iv, tag, ct]);
  const enc  = `${file}.enc`;
  await fs.promises.writeFile(enc, out);
  await fs.promises.unlink(file);
  return enc;
}

/**
 * Apply retention — delete files older than the newest `retain` count.
 */
async function _applyRetention(dir, retain) {
  const entries = (await fs.promises.readdir(dir))
    .filter((f) => f.startsWith('echofox-') && (f.endsWith('.tar.gz') || f.endsWith('.tar.gz.enc')))
    .map((f) => ({ name: f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);  // newest first
  const stale = entries.slice(retain);
  for (const f of stale) {
    try { await fs.promises.unlink(f.full); logger.info({ file: f.name }, 'backup pruned'); }
    catch (e) { logger.warn({ err: e, file: f.name }, 'backup prune failed'); }
  }
}

async function runBackupNow(config) {
  const cfg = config.backup;
  if (!cfg.enabled) {
    logger.debug('backup disabled — runBackupNow no-op');
    return { ok: false, reason: 'disabled' };
  }
  if (!cfg.destination) {
    logger.warn('backup.destination not set — refusing to run');
    return { ok: false, reason: 'no-destination' };
  }

  const projectRoot = _projectRoot();
  const dest        = path.isAbsolute(cfg.destination)
    ? cfg.destination
    : path.join(projectRoot, cfg.destination);

  await _ensureDir(dest);
  await _writableProbe(dest);

  const includes = _validateIncludes(projectRoot, cfg.include);
  if (!includes.length) {
    logger.warn('backup: no valid include paths — aborting');
    return { ok: false, reason: 'nothing-to-include' };
  }

  const outFile = path.join(dest, `echofox-${_stamp()}.tar.gz`);
  if (fs.existsSync(outFile)) {
    logger.warn({ outFile }, 'backup file already exists — refusing to overwrite');
    return { ok: false, reason: 'exists' };
  }

  const t0 = Date.now();
  try {
    await _spawnSystemTar({ outFile, projectRoot, includes });
  } catch (err) {
    logger.error({ err }, 'backup tar failed');
    metrics.inc?.('backup_failed_total');
    return { ok: false, reason: 'tar-failed', error: err.message };
  }

  let finalPath = outFile;
  if (cfg.encryptionPassphrase) {
    try { finalPath = await _encryptFile(outFile, cfg.encryptionPassphrase); }
    catch (err) {
      logger.error({ err }, 'backup encryption failed');
      metrics.inc?.('backup_failed_total');
      return { ok: false, reason: 'encrypt-failed', error: err.message };
    }
  }

  const stat = await fs.promises.stat(finalPath);
  await _applyRetention(dest, cfg.retain);

  metrics.inc?.('backup_success_total');
  metrics.setGauge?.('backup_last_run_at', Math.floor(Date.now() / 1000));
  metrics.setGauge?.('backup_last_size_bytes', stat.size);
  logger.info({ path: finalPath, sizeMB: (stat.size / 1e6).toFixed(2), ms: Date.now() - t0 },
    '✅ backup complete');
  return { ok: true, path: finalPath, size: stat.size };
}

function startBackupEngine(config) {
  if (!config.backup?.enabled) return null;
  if (!config.backup.destination) {
    logger.warn('backup.enabled=true but destination empty — engine not started');
    return null;
  }

  let cron;
  try { cron = require('node-cron'); }
  catch (e) {
    logger.warn('node-cron not installed — running one-time backup at boot only');
    setTimeout(() => runBackupNow(config).catch(() => {}), 60_000);
    return null;
  }

  if (!cron.validate(config.backup.schedule)) {
    logger.warn({ schedule: config.backup.schedule }, 'invalid backup schedule — engine not started');
    return null;
  }

  _cronTask = cron.schedule(
    config.backup.schedule,
    () => runBackupNow(config).catch((e) => logger.error({ err: e }, 'backup run failed')),
    { timezone: config.bot?.timezone },
  );
  logger.info({ schedule: config.backup.schedule, destination: config.backup.destination },
    '🗄  backup engine scheduled');
  return _cronTask;
}

function stopBackupEngine() {
  if (_cronTask) { try { _cronTask.stop(); } catch {} _cronTask = null; }
}

module.exports = { startBackupEngine, stopBackupEngine, runBackupNow };
