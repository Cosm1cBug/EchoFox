/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

'use strict';

/**
 * EchoFox – Bootstrap entry-point
 * --------------------------------
 *  • Spawns a *single* worker process (the WA socket).
 *  • The parent process is the watchdog: it restarts the worker on crash
 *    with exponential backoff, exposes /healthz + /metrics, and forwards
 *    OS signals (SIGTERM, SIGINT) for graceful shutdown.
 *
 *  We use child_process.fork instead of `cluster` (which is misused in the
 *  original repo – cluster is meant for HTTP load-balancing, not bot-respawn).
 */

const { fork } = require('node:child_process');
const path = require('node:path');
const express = require('express');
const client = require('prom-client');
const CFonts = require('cfonts');

const PORT = Number(process.env.PORT) || 3000;
const MAX_BACKOFF_MS = 60_000;
const MIN_BACKOFF_MS = 2_000;

// ─── Banner ───────────────────────────────────────────────────────────────
console.clear();
CFonts.say('EchoFox', {
  font: 'shade', align: 'center',
  gradient: ['#12c2e9', '#c471ed'], transitionGradient: true, letterSpacing: 3,
});
CFonts.say('v6.0 · Baileys 7.x · Production', {
  font: 'tiny', align: 'center',
  gradient: ['#DCE35B', '#45B649'], transitionGradient: true, letterSpacing: 2,
});

// ─── Prometheus registry ──────────────────────────────────────────────────
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });
const workerRestarts = new client.Counter({
  name: 'echofox_worker_restarts_total',
  help: 'Number of times the WA worker has been restarted',
  registers: [registry],
});
const workerUp = new client.Gauge({
  name: 'echofox_worker_up',
  help: '1 if the WA worker is alive, 0 otherwise',
  registers: [registry],
});

// ─── Worker supervisor ────────────────────────────────────────────────────
let worker;
let backoff = MIN_BACKOFF_MS;
let shuttingDown = false;
let lastReadyAt = 0;

function spawnWorker() {
  if (shuttingDown) return;

  const workerPath = path.join(__dirname, 'worker.js');
  worker = fork(workerPath, [], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, NODE_OPTIONS: '--enable-source-maps' },
  });
  workerUp.set(1);

  worker.on('message', (msg) => {
    if (msg === 'ready') {
      lastReadyAt = Date.now();
      backoff = MIN_BACKOFF_MS;          // reset backoff after stable run
    }
  });

  worker.on('exit', (code, signal) => {
    workerUp.set(0);
    if (shuttingDown) return;
    workerRestarts.inc();

    // If we crashed quickly, increase backoff; otherwise reset
    const aliveFor = Date.now() - lastReadyAt;
    if (aliveFor < 30_000) backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    else backoff = MIN_BACKOFF_MS;

    console.error(
      `[supervisor] worker exited (code=${code}, signal=${signal}). ` +
      `Restart in ${backoff}ms`,
    );
    setTimeout(spawnWorker, backoff);
  });
}

// ─── Health server ────────────────────────────────────────────────────────
const app = express();
app.get('/healthz', (_req, res) => {
  res.status(worker && !worker.killed ? 200 : 503).json({
    status: worker && !worker.killed ? 'ok' : 'down',
    uptime: process.uptime(),
    pid: worker?.pid ?? null,
  });
});
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});
app.listen(PORT, () => console.log(`[supervisor] health/metrics on :${PORT}`));

// ─── Graceful shutdown ────────────────────────────────────────────────────
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[supervisor] received ${signal}, terminating worker…`);

  if (worker && !worker.killed) {
    worker.send('shutdown');
    const t = setTimeout(() => worker.kill('SIGKILL'), 10_000);
    worker.on('exit', () => { clearTimeout(t); process.exit(0); });
  } else {
    process.exit(0);
  }
}
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
process.on('uncaughtException', (e) => console.error('[supervisor] uncaught:', e));
process.on('unhandledRejection', (e) => console.error('[supervisor] unhandled:', e));

// Go!
spawnWorker();
