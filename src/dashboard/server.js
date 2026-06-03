/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const express = require('express');
const path    = require('node:path');
const fs      = require('node:fs');
const { config } = require('../lib/configLoader');
const metrics = require('../services/metrics');
const logger  = require('../core/logger').child({ mod: 'dashboard' });

const PKG = (() => {
  try { return require(path.join(__dirname, '..', '..', 'package.json')); }
  catch { return { version: 'unknown' }; }
})();

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function basicAuth(username, password) {
  const expected = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  return (req, res, next) => {
    const got = req.headers.authorization;
    if (got && got === expected) return next();
    res.set('WWW-Authenticate', 'Basic realm="EchoFox Dashboard", charset="UTF-8"');
    res.status(401).type('text/plain').send('Authentication required');
  };
}

function startDashboard(port, store, config) {
  const app = express();
  app.set('trust proxy', true);

  if (config.dashboard.username) {
    app.use(basicAuth(config.dashboard.username, config.dashboard.password));
  } else {
    logger.warn('dashboard auth DISABLED (empty username) — DO NOT EXPOSE PUBLICLY');
  }

  app.use(express.json({ limit: '64kb' }));

  app.use('/dashboard', express.static(path.join(__dirname, 'react')));

  app.get('/dashboard/*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'react', 'index.html'));
  });

  app.get('/', (_req, res) => {
    res.type('html').send(
      HTML
        .replace('__BOT_NAME__',  String(config.bot.name).replace(/</g, '&lt;'))
        .replace('__VERSION__',   PKG.version)
        .replace('__BACKEND__',   `${config.storeDB.type}/${config.auth.method}`),
    );
  });

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

  // ── NEW v0.4.3: per-message timeline endpoints ─────────────────────
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

  // ── v0.4.5: diagnostics + alerts ───────────────────────────────────
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

  // ── Error handler ─────────────────────────────────────────────────────
  app.use((err, _req, res, _next) => {
    logger.error({ err }, 'dashboard route error');
    res.status(500).json({ error: 'internal', message: err.message });
  });

  app.listen(port, () => {
    logger.info({ port, auth: !!config.dashboard.username }, 'dashboard listening');
  });
}

module.exports = { startDashboard };