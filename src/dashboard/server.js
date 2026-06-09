/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const path    = require('node:path');
const fs      = require('node:fs');
const { spawnSync } = require('node:child_process');
const { config } = require('../lib/configLoader');
const metrics    = require('../services/metrics');

const logger = require('../core/logger').child({ mod: 'dashboard' });

const PKG = (() => {
  try { return require(path.join(__dirname, '..', '..', 'package.json')) }
  catch { return { version: 'unknown' } }
})();

const REACT_DIR = path.join(__dirname, 'react');

function basicAuth(username, password) {
  const expected = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  return (req, res, next) => {
    const got = req.headers.authorization;
    if (got && got === expected) return next();
    res.set('WWW-Authenticate', 'Basic realm="EchoFox Dashboard", charset="UTF-8"');
    res.status(401).type('text/plain').send('Authentication required');
  };
}

/**
 * Build the React dashboard if its output is missing.
 *   Triggered once at boot inside startDashboard().
 *   Safe to call multiple times — idempotent if dist already exists.
 *   Returns true if the dashboard is ready to serve.
 */
function ensureReactBuilt() {
  const indexHtml = path.join(REACT_DIR, 'index.html');
  if (fs.existsSync(indexHtml)) return true;

  logger.warn({ path: REACT_DIR },
    'React dashboard build missing — attempting build-on-boot. ' +
    'Run `npm run build:dashboard` ahead of time to skip this step.');
  try {
    const script = path.join(__dirname, '..', '..', 'scripts', 'build-dashboard.js');
    const result = spawnSync(process.execPath, [script], {
      stdio: 'inherit',
      shell: false,
    });
    if (result.status === 0 && fs.existsSync(indexHtml)) {
      logger.info('React dashboard built successfully');
      return true;
    }
    logger.error({ status: result.status },
      'build-on-boot failed — dashboard will return a maintenance page');
    return false;
  } catch (err) {
    logger.error({ err: err.message },
      'build-on-boot threw — dashboard will return a maintenance page');
    return false;
  }
}

function maintenancePage(reason) {
  return `<!DOCTYPE html>
<html><head><title>EchoFox Dashboard</title>
<style>body{font-family:-apple-system,sans-serif;background:#020617;color:#f1f5f9;padding:3rem;line-height:1.6}
h1{color:#f97316}code{background:#1e293b;padding:.15rem .4rem;border-radius:.25rem}</style>
</head><body>
<h1>🦊 Dashboard build missing</h1>
<p>The React dashboard hasn't been built yet on this machine.</p>
<p>From the repo root, run:</p>
<pre><code>npm run build:dashboard</code></pre>
<p>Then refresh this page. Detail: ${reason || 'unknown'}</p>
</body></html>`;
}

function startDashboard(port, store, config) {
  const app = express();
  app.set('trust proxy', true);
  // v1.0.1 — rate-limit BOTH /api (data endpoints) and /dashboard (auth surface)
  const dashboardLimiter = rateLimit({
    windowMs:        15 * 60 * 1000,   // 15-minute window
    max:             300,               // 300 requests per IP per window
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { error: 'rate_limited', message: 'Too many requests; slow down.' },
  });
  app.use('/api',       dashboardLimiter);
  app.use('/dashboard', dashboardLimiter);

  const dashboardLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });

  if (config.dashboard.username) {
    app.use(basicAuth(config.dashboard.username, config.dashboard.password));
  } else {
    logger.warn('dashboard auth DISABLED (empty username) — DO NOT EXPOSE PUBLICLY');
  }

  app.use(express.json({ limit: '64kb' }));
  app.use('/dashboard', dashboardLimiter);

  // Build-on-boot guard (one-shot). If it fails we still mount API routes
  // and serve a maintenance page for / and /dashboard.
  const reactReady = ensureReactBuilt();

  // ─── Root redirect: / → /dashboard/ ──────────────────────────────────
  app.get('/', (_req, res) => res.redirect(301, '/dashboard/'));

  // ─── React app static + SPA fallback ─────────────────────────────────
  if (reactReady) {
    app.use('/dashboard', express.static(REACT_DIR, { index: 'index.html' }));
    app.get('/dashboard/*', (_req, res) => {
      res.sendFile(path.join(REACT_DIR, 'index.html'));
    });
  } else {
    app.get(['/dashboard', '/dashboard/*'], (_req, res) => {
      res.status(503).type('html').send(maintenancePage('React build missing'));
    });
  }

  // ─── API: health / stats / version ───────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({
      ok:      true,
      uptime:  process.uptime(),
      version: PKG.version,
      backends: {
        store: config.storeDB.type,
        auth:  config.auth.method,
        login: config.login.type,
      },
    });
  });

  app.get('/api/stats', async (_req, res, next) => {
    try { res.json(await metrics.snapshot()); }
    catch (e) { next(e); }
  });

  // ─── API: groups ─────────────────────────────────────────────────────
  app.get('/api/groups', async (_req, res, next) => {
    try {
      const rows = typeof store.listGroups === 'function'
        ? await store.listGroups()
        : [];
      res.json(rows);
    } catch (e) { next(e); }
  });

  app.get('/api/groups/:jid', async (req, res, next) => {
    try {
      const meta = await store.getGroupMetadata(req.params.jid);
      if (!meta) return res.status(404).json({ error: 'not_found' });
      res.json(meta);
    } catch (e) { next(e); }
  });

  app.get('/api/groups/:jid/participants', async (req, res, next) => {
    try { res.json(await store.getCurrentParticipants(req.params.jid)); }
    catch (e) { next(e); }
  });

  app.get('/api/groups/:jid/participants/history', async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 200, 2000);
      res.json(await store.getParticipantHistory(req.params.jid, limit));
    } catch (e) { next(e); }
  });

  // ── Per-message timeline endpoints ─────────────────────
  app.get('/api/messages/:jid/:id/edits', async (req, res, next) => {
    try {
      const edits = await store.getMessageEdits?.(req.params.jid, req.params.id) || [];
      res.json(edits);
    } catch (e) { next(e); }
  });

  app.get('/api/messages/:jid/:id/reactions', async (req, res, next) => {
    try {
      const reactions = await store.getMessageReactions?.(req.params.jid, req.params.id) || [];
      res.json(reactions);
    } catch (e) { next(e); }
  });

  app.get('/api/messages/:jid/:id/receipts', async (req, res, next) => {
    try {
      const receipts = await store.getMessageReceipts?.(req.params.jid, req.params.id) || [];
      res.json(receipts);
    } catch (e) { next(e); }
  });

  app.get('/api/groups/:jid/deleted', async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 1000);
      const deleted = await store.getDeletedInGroup?.(req.params.jid, limit) || [];
      res.json(deleted);
    } catch (e) { next(e); }
  });

  // ── Diagnostics + alerts ───────────────────────────────────
  app.get('/api/diagnostics', async (_req, res, next) => {
    try {
      const { runDiagnostics, getRuntimeContext } = require('../lib/diagnostics');
      const ctx = getRuntimeContext();
      const report = await runDiagnostics(ctx);
      res.status(report.ok ? 200 : 503).json(report);
    } catch (e) { next(e); }
  });

  app.get('/api/alerts', (_req, res, next) => {
    try {
      const engine = require('../services/alertEngine');
      res.json({
        active: engine.getActiveAlerts(),
      });
    } catch (e) { next(e); }
  });

  app.get('/api/alerts/:cmd', (req, res, next) => {
    try {
      const engine = require('../services/alertEngine');
      res.json(engine.getRate(req.params.cmd));
    } catch (e) { next(e); }
  });

    // ── Subscriptions audit view ───────────────────────────────
  app.get('/api/subscriptions', async (_req, res, next) => {
    try {
      const services = ['alienvault', 'thehackersnews', 'rss', 'github', 'vtwatch'];
      const out = {};
      for (const svc of services) {
        const subs = (typeof store.getSubscribers === 'function')
          ? await store.getSubscribers(svc)
          : [];
        out[svc] = subs.map((s) => ({
          jid: s.jid,
          last_seen_pulse_ts: s.last_seen_pulse_ts,
          meta: s.meta || null,
        }));
      }
      res.json(out);
    } catch (e) { next(e); }
  });

  // ── Error handler ─────────────────────────────────────────────────────
  app.use((err, _req, res, _next) => {
    logger.error({ err }, 'dashboard route error');
    res.status(500).json({ error: 'internal', message: err.message });
  });

  app.listen(port, () => {
    logger.info({ port, auth: !!config.dashboard.username, react: reactReady },
      'dashboard listening');
  });
}

module.exports = { startDashboard };