/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * EchoFox web dashboard.
 *
 *   Enable with config.dashboard.enabled = true. Listens on
 *   config.dashboard.port (default 3001). Protected with HTTP Basic Auth
 *   using config.dashboard.username / config.dashboard.password.
 *
 *   Routes:
 *     GET  /                                         HTML dashboard (single page)
 *     GET  /api/health                               { ok, uptime, version }
 *     GET  /api/stats                                { counters, gauges, startedAt }
 *     GET  /api/groups                               [{ jid, subject, participantCount }]
 *     GET  /api/groups/:jid                          full group metadata
 *     GET  /api/groups/:jid/participants             current participants
 *     GET  /api/groups/:jid/participants/history     full event log (paginated)
 *
 *   The HTML page calls the JSON endpoints every 5 s and renders tiles +
 *   tables with vanilla JS — no external CDN, no build step.
 */

const express = require('express');
const path    = require('node:path');
const fs      = require('node:fs');

const metrics = require('../services/metrics');
const logger  = require('../core/logger').child({ mod: 'dashboard' });

const PKG = (() => {
  try { return require(path.join(__dirname, '..', '..', 'package.json')); }
  catch { return { version: 'unknown' }; }
})();

// ─── HTML page (single-file SPA, no external deps) ──────────────────────
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ─── Basic Auth middleware ──────────────────────────────────────────────
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

  // Trust X-Forwarded-* headers when behind a reverse proxy (Caddy, nginx, etc.)
  app.set('trust proxy', true);

  // Auth (unless explicitly disabled with empty username)
  if (config.dashboard.username) {
    app.use(basicAuth(config.dashboard.username, config.dashboard.password));
  } else {
    logger.warn('dashboard auth DISABLED (empty username) — DO NOT EXPOSE PUBLICLY');
  }

  app.use(express.json({ limit: '64kb' }));

  // ── HTML root ─────────────────────────────────────────────────────────
  app.get('/', (_req, res) => {
    res.type('html').send(
      HTML
        .replace('__BOT_NAME__',  String(config.bot.name).replace(/</g, '&lt;'))
        .replace('__VERSION__',   PKG.version)
        .replace('__BACKEND__',   `${config.storeDB.type}/${config.auth.method}`),
    );
  });

  // ── Health (also safe to call without auth via /api/health-public; we keep it gated) ─
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

  // ── Stats: counters + gauges (typed) ──────────────────────────────────
  app.get('/api/stats', async (_req, res, next) => {
    try {
      const snap = await metrics.snapshot();
      res.json(snap);
    } catch (e) { next(e); }
  });

  // ── Groups: list ──────────────────────────────────────────────────────
  app.get('/api/groups', async (_req, res, next) => {
    try {
      // We don't have a single "list all groups" call on every backend.
      // For SQLite we go straight to the table; for others we use the
      // in-memory groupCache via getGroupMetadata is too slow N-way.
      // Use what each backend exposes — fall back to empty array.
      let rows = [];

      if (typeof store.db?.prepare === 'function') {
        // SQLite path
        rows = store.db.prepare(`SELECT jid, subject, meta FROM groups`).all().map((r) => {
          let meta = null;
          try { meta = JSON.parse(r.meta.toString('utf8')); } catch {}
          return {
            jid:     r.jid,
            subject: r.subject || meta?.subject || '(unnamed)',
            participantCount: meta?.participants?.length || 0,
          };
        });
      } else {
        rows = [];
      }
      res.json(rows);
    } catch (e) { next(e); }
  });

  // ── Group detail (full metadata) ──────────────────────────────────────
  app.get('/api/groups/:jid', async (req, res, next) => {
    try {
      const meta = await store.getGroupMetadata(req.params.jid);
      if (!meta) return res.status(404).json({ error: 'not_found' });
      res.json(meta);
    } catch (e) { next(e); }
  });

  // ── Current participants (derived from latest event per participant) ──
  app.get('/api/groups/:jid/participants', async (req, res, next) => {
    try {
      const list = await store.getCurrentParticipants(req.params.jid);
      res.json(list);
    } catch (e) { next(e); }
  });

  // ── Participant event history (paginated) ─────────────────────────────
  app.get('/api/groups/:jid/participants/history', async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 200, 2000);
      const events = await store.getParticipantHistory(req.params.jid, limit);
      res.json(events);
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
