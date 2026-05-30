/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';

/**
 * Daily log-file rotator.
 *
 *   Writes a JSON line per log record to:
 *     <dir>/<prefix>-YYYY-MM-DD.log
 *
 *   At each midnight (in config timezone), opens a new file. Old files
 *   are NOT auto-deleted; users typically pair this with logrotate or
 *   their own retention cron. We do log a daily INFO with sizes so you
 *   can spot runaway-log situations.
 *
 *   Failures of file writes never crash the bot — they're silently
 *   suppressed (stdout pino transport remains the source of truth).
 *
 *   Used by src/core/logger.js when config.runtime.logFile.enabled = true.
 *
 *   Exposes a writable stream consumer that pino can pipe into. We
 *   intentionally do not use pino's multistream feature so this module
 *   is decoupled from pino internals (works across pino major versions).
 */

const fs   = require('node:fs');
const path = require('node:path');

function dateStamp(d = new Date(), tz) {
  // YYYY-MM-DD in the given timezone. Falls back to local if tz omitted.
  if (!tz) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  // Intl-based — robust against DST.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${day}`;
}

function msUntilNextMidnight(tz) {
  const now = new Date();
  const today = dateStamp(now, tz);
  // Probe forward in 1-min increments until the date stamp flips.
  // This is robust against DST jumps without needing per-zone math.
  let probe = new Date(now.getTime());
  for (let i = 0; i < 24 * 60 + 5; i++) {
    probe = new Date(probe.getTime() + 60_000);
    if (dateStamp(probe, tz) !== today) {
      return probe.getTime() - now.getTime();
    }
  }
  return 24 * 60 * 60 * 1000;  // fallback: 24h
}

function makeDailyFileStream({ dir, prefix = 'echofox', tz }) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let currentDate = null;
  let currentStream = null;
  let bytesWrittenToday = 0;
  let rotateTimer = null;

  const open = () => {
    const date = dateStamp(new Date(), tz);
    if (date === currentDate && currentStream) return currentStream;
    if (currentStream) {
      try { currentStream.end(); } catch {}
    }
    const file = path.join(dir, `${prefix}-${date}.log`);
    currentStream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
    currentStream.on('error', () => { /* swallow — stdout is source of truth */ });
    currentDate = date;
    bytesWrittenToday = 0;

    // Schedule next rotate
    if (rotateTimer) clearTimeout(rotateTimer);
    const ms = msUntilNextMidnight(tz);
    rotateTimer = setTimeout(open, ms + 1000);
    rotateTimer.unref();
    return currentStream;
  };

  // Public stream-ish: only .write() and .end() — that's all pino needs.
  return {
    write(chunk) {
      try {
        const s = open();
        s.write(chunk);
        bytesWrittenToday += chunk.length;
      } catch { /* never throw from logger path */ }
    },
    end() {
      try { if (currentStream) currentStream.end(); } catch {}
      if (rotateTimer) clearTimeout(rotateTimer);
    },
    getStats() {
      return { currentDate, bytesWrittenToday, file: currentStream?.path };
    },
  };
}

module.exports = { makeDailyFileStream, dateStamp, msUntilNextMidnight };
