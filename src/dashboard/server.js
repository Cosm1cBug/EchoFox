/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const fs = require('node:fs');
const metrics = require('../services/metrics');

const logger = require('../core/logger').child({ mod: 'dashboard' });

const PKG = (() => {
  try {
    return require(path.join(__dirname, '..', '..', 'package.json'));
  } catch {
    return { version: 'unknown' };
  }
})();

const REACT_DIR = path.join(__dirname, 'react');

function basicAuth(username, password) {
  const expected = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const expectedBuf = Buffer.from(expected, 'utf8');

  return (req, res, next) => {
    const got = req.headers.authorization;
    const gotBuf = got ? Buffer.from(got, 'utf8') : Buffer.alloc(0);

    // Length check first (timingSafeEqual requires equal lengths), then a
    // constant-time compare so the header can't be recovered byte-by-byte
    // from response timing.
    const ok = gotBuf.length === expectedBuf.length && crypto.timingSafeEqual(gotBuf, expectedBuf);

    if (ok) return next();
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

  logger.warn(
    { path: REACT_DIR },
    'React dashboard build missing — attempting build-on-boot in background.',
  );

  // Run build in background (non-blocking)
  setImmediate(() => {
    try {
      const script = path.join(__dirname, '..', '..', 'scripts', 'build-dashboard.js');
      const child = require('child_process').spawn(process.execPath, [script], {
        stdio: 'inherit',
        shell: false,
      });

      child.on('close', (code) => {
        if (code === 0 && fs.existsSync(indexHtml)) {
          logger.info('React dashboard built successfully in background');
        } else {
          logger.error({ code }, 'Background dashboard build failed');
        }
      });

      child.on('error', (err) => {
        logger.error({ err: err.message }, 'Background build process error');
      });
    } catch (err) {
      logger.error({ err: err.message }, 'Background build-on-boot threw an error');
    }
  });

  return false; // Return false so the maintenance page is shown until build completes
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
  // Only trust a proxy that is genuinely in front of us.
  //   'loopback'      docker-compose publishes on 127.0.0.1 (current default)
  //   1               exactly one reverse-proxy hop (nginx / Caddy / Traefik)
  //   '10.0.0.0/8'    your container network
  // NEVER `true`: express-rate-limit reads req.ip, so trusting every peer lets
  // any client send a spoofed X-Forwarded-For and reset its own bucket,
  // disabling both limiters below.
  app.set('trust proxy', config.dashboard?.trustProxy ?? 'loopback');
  // v1.0.1 — rate-limit BOTH /api (data endpoints) and /dashboard (auth surface)
  const dashboardLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15-minute window
    max: 300, // 300 requests per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Too many requests; slow down.' },
  });
  app.use('/api', dashboardLimiter);
  app.use('/dashboard', dashboardLimiter);

  // ── /metrics needs its OWN ceiling, not the dashboard one ──────────────
  // Prometheus scrapes every 15s (config default) = 4/min = 240 requests per
  // 15-minute window, which is already 80% of the 300-request dashboard cap.
  // Sharing that bucket would either throttle the scrape or starve the
  // dashboard. Previously /metrics and / were not limited at all.
  const metricsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1500, // ~6 scrapers at 15s, or one at 1s — generous but bounded
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Too many metric scrapes.' },
  });
  app.use('/metrics', metricsLimiter);

  // `/` is only a 301 to /dashboard/, but leaving it unlimited made it a free
  // request amplifier against the auth middleware below.
  app.use('/', dashboardLimiter);

  if (config.dashboard.username) {
    app.use(basicAuth(config.dashboard.username, config.dashboard.password));
  } else {
    logger.warn('dashboard auth DISABLED (empty username) — DO NOT EXPOSE PUBLICLY');
  }

  app.use(express.json({ limit: '64kb' }));

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
  app.get('/api/health', async (_req, res) => {
    // v1.17.0 — richer readiness probe.
    // Returns 503 (Service Unavailable) when degraded so K8s/probes flip
    // the bot out of the load-balancer pool until it recovers.
    const checks = { store: false, loginConnected: false, lastMsgAgoSec: null };
    let degraded = false;

    // Store ping: cheap call against the existing API (getStats fits this).
    try {
      if (typeof store?.getStats === 'function') {
        await store.getStats();
      }
      checks.store = true;
    } catch (_) {
      degraded = true;
    }

    // Login state: from connectionState updated by worker.js on every
    // connection.update event.
    try {
      const cs = require('../services/connectionState');
      checks.loginConnected = cs.isConnected();
      const csInfo = cs.get();
      checks.connectionPhase = csInfo.connection;
      if (csInfo.lastCloseAt) checks.lastCloseAt = csInfo.lastCloseAt;
      if (csInfo.lastOpenAt) checks.lastOpenAt = csInfo.lastOpenAt;
      // 'pending' counts as not-yet-ready but not failed — don't 503 during boot
      if (csInfo.connection === 'close') degraded = true;
    } catch (_) {
      checks.loginConnected = true;
    }

    // Last inbound message age: warns if no traffic for >10 min in a chat.
    try {
      if (typeof store?.getGauges === 'function') {
        const g = await store.getGauges();
        // No dedicated last_msg gauge; use uptime as a coarse proxy.
        // (Could wire a `last_inbound_msg_ts` gauge in a follow-up.)
        const u = Number(g.bot_uptime_seconds) || Math.floor(process.uptime());
        checks.lastMsgAgoSec = u < 60 ? null : null; // placeholder
      }
    } catch (_) {
      /* ignore */
    }

    const body = {
      ok: !degraded,
      degraded,
      uptime: process.uptime(),
      version: PKG.version,
      backends: {
        store: config.storeDB.type,
        auth: config.auth.method,
        login: config.login.type,
      },
      checks,
    };
    res.status(degraded ? 503 : 200).json(body);
  });

  app.get('/api/stats', async (_req, res, next) => {
    try {
      res.json(await metrics.snapshot());
    } catch (e) {
      next(e);
    }
  });

  // ─── API: groups ─────────────────────────────────────────────────────
  app.get('/api/groups', async (_req, res, next) => {
    try {
      const rows = typeof store.listGroups === 'function' ? await store.listGroups() : [];
      // v1.13.0 — enrich each group with `lastHumanMsgTs` + `active` flag.
      // Inactivity threshold defaults to 14 days (config.dashboard.inactiveAfterDays).
      const inactiveDays = Number(config.dashboard?.inactiveAfterDays) || 14;
      const cutoffSec = Math.floor(Date.now() / 1000) - inactiveDays * 86400;
      // One aggregate query for every group instead of one query per group.
      // The store is better-sqlite3, so the previous N+1 issued N *synchronous*
      // statements on every 15 s dashboard poll — blocking the same event loop
      // that serves WhatsApp traffic.
      let tsMap = null;
      if (typeof store.getLastHumanMessageTsMap === 'function') {
        try {
          tsMap = store.getLastHumanMessageTsMap();
        } catch {
          tsMap = null; // fall through to the per-jid path
        }
      }

      const enriched = await Promise.all(
        rows.map(async (g) => {
          let lastHumanMsgTs = null;
          try {
            if (tsMap) {
              lastHumanMsgTs = tsMap.get(g.jid) ?? null;
            } else if (typeof store.getLastHumanMessageTs === 'function') {
              lastHumanMsgTs = await store.getLastHumanMessageTs(g.jid);
            }
          } catch {
            /* fail-closed: null = unknown */
          }
          const active = lastHumanMsgTs == null ? null : lastHumanMsgTs >= cutoffSec;
          return { ...g, lastHumanMsgTs, active, inactiveAfterDays: inactiveDays };
        }),
      );
      res.json(enriched);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/groups/:jid', async (req, res, next) => {
    try {
      const meta = await store.getGroupMetadata(req.params.jid);
      if (!meta) return res.status(404).json({ error: 'not_found' });
      res.json(meta);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/groups/:jid/participants', async (req, res, next) => {
    try {
      res.json(await store.getCurrentParticipants(req.params.jid));
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/groups/:jid/participants/history', async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 200, 2000);
      res.json(await store.getParticipantHistory(req.params.jid, limit));
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/groups/:jid/full', async (req, res, next) => {
    try {
      const jid = req.params.jid;
      const historyLimit = Math.min(Number(req.query.historyLimit) || 200, 2000);

      const [meta, participants, history, lastHumanMsgTs, settingsHistory, muteHistory] =
        await Promise.all([
          store.getGroupMetadata(jid).catch(() => null),
          store.getCurrentParticipants(jid).catch(() => []),
          store.getParticipantHistory(jid, historyLimit).catch(() => []),
          typeof store.getLastHumanMessageTs === 'function'
            ? store.getLastHumanMessageTs(jid).catch(() => null)
            : Promise.resolve(null),

          typeof store.getGroupSettingsHistory === 'function'
            ? store.getGroupSettingsHistory(jid, historyLimit).catch(() => [])
            : Promise.resolve([]),

          typeof store.getMuteHistoryByChat === 'function'
            ? store.getMuteHistoryByChat(jid, 100).catch(() => [])
            : Promise.resolve([]),
        ]);

      if (!meta) return res.status(404).json({ error: 'not_found' });

      const inactiveDays = Number(config.dashboard?.inactiveAfterDays) || 14;
      const cutoffSec = Math.floor(Date.now() / 1000) - inactiveDays * 86400;
      const active = lastHumanMsgTs == null ? null : lastHumanMsgTs >= cutoffSec;

      res.json({
        jid,
        meta,
        participants,
        history,
        settingsHistory,
        muteHistory,
        lastHumanMsgTs,
        active,
        inactiveAfterDays: inactiveDays,
      });
    } catch (e) {
      next(e);
    }
  });

  // GET /api/chats/:jid/full - Full details of a contact
  app.get('/api/chats/:jid/full', async (req, res, next) => {
    try {
      const jid = req.params.jid;

      if (typeof store.getContact !== 'function') {
        return res.status(404).json({ error: 'not_implemented' });
      }

      const contact = await store.getContact(jid);
      if (!contact) return res.status(404).json({ error: 'not_found' });

      // Get presence
      const presence =
        typeof store.getPresence === 'function' ? await store.getPresence(jid) : null;

      // Get message stats
      const stats = typeof store.getChatStats === 'function' ? await store.getChatStats(jid) : null;

      // Get first/last seen
      const seen =
        typeof store.getFirstLastSeen === 'function' ? await store.getFirstLastSeen(jid) : null;

      // Get command usage
      const commands =
        typeof store.getCommandUsageByChat === 'function'
          ? await store.getCommandUsageByChat(jid)
          : [];

      // Phone enrichment (basic)
      const phone = jid.split('@')[0];
      let enrichment = null;
      try {
        const phoneUtil = require('libphonenumber-js');
        const parsed = phoneUtil.parsePhoneNumber('+' + phone);
        if (parsed) {
          enrichment = {
            country: parsed.country || null,
            countryCode: parsed.countryCallingCode || null,
            nationalNumber: parsed.nationalNumber || null,
          };
        }
      } catch (_) {
        // ignore enrichment errors
      }

      res.json({
        jid,
        contact,
        presence,
        stats,
        seen,
        commands,
        enrichment,
      });
    } catch (e) {
      next(e);
    }
  });

  // ── Per-message timeline endpoints ─────────────────────
  app.get('/api/messages/:jid/:id/edits', async (req, res, next) => {
    try {
      const edits = (await store.getMessageEdits?.(req.params.jid, req.params.id)) || [];
      res.json(edits);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/messages/:jid/:id/reactions', async (req, res, next) => {
    try {
      const reactions = (await store.getMessageReactions?.(req.params.jid, req.params.id)) || [];
      res.json(reactions);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/messages/:jid/:id/receipts', async (req, res, next) => {
    try {
      const receipts = (await store.getMessageReceipts?.(req.params.jid, req.params.id)) || [];
      res.json(receipts);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/groups/:jid/deleted', async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 1000);
      const deleted = (await store.getDeletedInGroup?.(req.params.jid, limit)) || [];
      res.json(deleted);
    } catch (e) {
      next(e);
    }
  });

  // ── Diagnostics + alerts ───────────────────────────────────
  app.get('/api/diagnostics', async (_req, res, next) => {
    try {
      const { runDiagnostics, getRuntimeContext } = require('../lib/diagnostics');
      const ctx = getRuntimeContext();
      const report = await runDiagnostics(ctx);
      res.status(report.ok ? 200 : 503).json(report);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/alerts', (_req, res, next) => {
    try {
      const engine = require('../services/alertEngine');
      res.json({
        active: engine.getActiveAlerts(),
      });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/alerts/:cmd', (req, res, next) => {
    try {
      const engine = require('../services/alertEngine');
      res.json(engine.getRate(req.params.cmd));
    } catch (e) {
      next(e);
    }
  });

  // ── Subscriptions audit view ───────────────────────────────
  app.get('/api/subscriptions', async (_req, res, next) => {
    try {
      const services = ['alienvault', 'thehackersnews', 'rss', 'github', 'vtwatch'];
      const out = {};
      for (const svc of services) {
        const subs =
          typeof store.getSubscribers === 'function' ? await store.getSubscribers(svc) : [];
        out[svc] = subs.map((s) => ({
          jid: s.jid,
          last_seen_pulse_ts: s.last_seen_pulse_ts,
          meta: s.meta || null,
        }));
      }
      res.json(out);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/blocklist', async (_req, res, next) => {
    try {
      const data = typeof store.getBlocklist === 'function' ? await store.getBlocklist() : [];
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/contacts', async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;
      if (typeof store.listContacts !== 'function') return res.json({ items: [], total: 0 });
      const [items, total] = await Promise.all([
        store.listContacts({ limit, offset }),
        store.countContacts(),
      ]);
      res.json({ items, total, limit, offset });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/contacts/:jid', async (req, res, next) => {
    try {
      if (typeof store.getContact !== 'function')
        return res.status(404).json({ error: 'not_implemented' });
      const c = await store.getContact(req.params.jid);
      if (!c) return res.status(404).json({ error: 'not_found' });
      res.json(c);
    } catch (e) {
      next(e);
    }
  });

  // NOTE: this must be the ONLY registration for /api/chats. A second
  // handler used to be declared earlier (calling store.listContactsWithPresence,
  // which no backend implements) — Express dispatches to the first match, so
  // that dead handler won and this endpoint always returned an empty list,
  // which is why the dashboard's Chats tab never showed anything.
  // GET /api/chats — merged chat/contact view.
  //
  // Prefers store.listChatsEnriched(), which returns one row per person with
  // saved name + push name, both addressing forms (PN and LID), first/last
  // inbound message timestamps, and live presence — all in a single query.
  // Falls back to the plain chat list on backends that do not implement it.
  app.get('/api/chats', async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 200, 1000);
      const offset = Number(req.query.offset) || 0;

      if (typeof store.listChatsEnriched === 'function') {
        const out = store.listChatsEnriched({ limit, offset });
        const result = out && typeof out.then === 'function' ? await out : out;
        return res.json(result);
      }

      if (typeof store.listChats !== 'function') {
        return res.json({ items: [], total: 0, limit, offset });
      }
      const all = await store.listChats();
      const items = all.slice(offset, offset + limit);
      res.json({ items, total: all.length, limit, offset });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/chats/:jid', async (req, res, next) => {
    try {
      if (typeof store.getChat !== 'function')
        return res.status(404).json({ error: 'not_implemented' });
      const c = await store.getChat(req.params.jid);
      if (!c) return res.status(404).json({ error: 'not_found' });
      res.json(c);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/presence', async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 500);
      const data =
        typeof store.getRecentPresence === 'function' ? await store.getRecentPresence(limit) : [];
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/presence/:jid', async (req, res, next) => {
    try {
      if (typeof store.getPresence !== 'function')
        return res.status(404).json({ error: 'not_implemented' });
      const p = await store.getPresence(req.params.jid);
      if (!p) return res.status(404).json({ error: 'not_found' });
      res.json(p);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/chats/:jid/presence', async (req, res, next) => {
    try {
      const data =
        typeof store.getPresenceInChat === 'function'
          ? await store.getPresenceInChat(req.params.jid)
          : [];
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/labels', async (_req, res, next) => {
    try {
      const data = typeof store.listLabels === 'function' ? await store.listLabels() : [];
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/labels/:id/associations', async (req, res, next) => {
    try {
      const data =
        typeof store.getLabelAssociations === 'function'
          ? await store.getLabelAssociations(req.params.id)
          : [];
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/chats/:jid/labels', async (req, res, next) => {
    try {
      const data =
        typeof store.getLabelsForTarget === 'function'
          ? await store.getLabelsForTarget(req.params.jid)
          : [];
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/newsletters', async (_req, res, next) => {
    try {
      const data = typeof store.listNewsletters === 'function' ? await store.listNewsletters() : [];
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/newsletters/:id', async (req, res, next) => {
    try {
      if (typeof store.getNewsletter !== 'function')
        return res.status(404).json({ error: 'not_implemented' });
      const n = await store.getNewsletter(req.params.id);
      if (!n) return res.status(404).json({ error: 'not_found' });
      const settings =
        typeof store.getNewsletterSettings === 'function'
          ? await store.getNewsletterSettings(req.params.id)
          : null;
      res.json({ ...n, settings: settings?.settings || null });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/newsletters/:id/views', async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const data =
        typeof store.getNewsletterViews === 'function'
          ? await store.getNewsletterViews(req.params.id, null, limit)
          : [];
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/newsletters/:id/:msgId/reactions', async (req, res, next) => {
    try {
      const data =
        typeof store.getNewsletterReactions === 'function'
          ? await store.getNewsletterReactions(req.params.id, req.params.msgId)
          : [];
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/lid-mapping/:lid', async (req, res, next) => {
    try {
      if (typeof store.getLidMapping !== 'function')
        return res.status(404).json({ error: 'not_implemented' });
      const jid = await store.getLidMapping(req.params.lid);
      if (!jid) return res.status(404).json({ error: 'not_found' });
      res.json({ lid: req.params.lid, jid });
    } catch (e) {
      next(e);
    }
  });

  // ── v1.4.0 Prometheus exposition for store-backed metrics ────────────
  //
  // The supervisor (bootstrap.js) already exposes worker_up + Node.js
  // defaults at :3000/metrics. The store-backed counters/gauges live
  // in the worker process, so we expose them here on the dashboard port
  // in Prometheus text format. Prefix: echofox_
  app.get('/metrics', async (_req, res) => {
    try {
      const snap = await metrics.snapshot();
      const lines = [];
      const now = Date.now();
      const seen = new Set();

      // Arrow assigned to a const is NOT a function declaration, so the
      // `no-inner-declarations` ESLint rule doesn't apply — and it correctly
      // closes over lines/now/seen which are scoped to this route handler.
      const emit = (_prefix, m, type, help) => {
        for (const [k, v] of Object.entries(m || {})) {
          if (seen.has(k)) continue;
          seen.add(k);
          const name = `echofox_${k}`;
          lines.push(`# HELP ${name} ${help || 'store-backed metric'}`);
          lines.push(`# TYPE ${name} ${type}`);
          lines.push(`${name} ${Number(v) || 0} ${now}`);
        }
      };

      emit('counter', snap.counters, 'counter', 'EchoFox counter');
      emit('gauge', snap.gauges, 'gauge', 'EchoFox gauge');

      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.end(lines.join('\n') + '\n');
    } catch (e) {
      logger.warn({ err: e }, 'metrics export failed');
      res.status(500).type('text/plain').send('# metrics unavailable\n');
    }
  });

  // ── Conversation history + send (dashboard Chat tab) ──────────────────
  //
  //   GET  /api/conversations/:jid/messages   → decoded history, oldest-first
  //   POST /api/conversations/send            → { jid, text }
  //
  // The send path is the ONLY mutating action the dashboard exposes, so it is
  // deliberately conservative:
  //     • already behind the dashboard's HTTP Basic Auth (applied above)
  //     • jid must be a well-formed user or group JID
  //     • text must be a non-empty string, capped in length
  //     • socket must exist and the connection must be open
  //     • every send is written to the admin audit log
  const JID_RE = /^(\d+@s\.whatsapp\.net|\d+@g\.us|\d+@lid)$/;
  const MAX_SEND_CHARS = 4096;

  app.get('/api/conversations/:jid/messages', async (req, res, next) => {
    try {
      const jid = req.params.jid;
      if (!JID_RE.test(jid)) {
        return res.status(400).json({ error: 'invalid_jid' });
      }
      if (typeof store.listMessages !== 'function') {
        return res.json({ items: [], unavailable: true });
      }
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const before = req.query.before ? Number(req.query.before) : null;

      let items = store.listMessages(jid, { limit, before });
      if (items && typeof items.then === 'function') items = await items;

      res.json({ items, jid, limit, before });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/conversations/send', async (req, res, next) => {
    try {
      const { jid, text } = req.body || {};

      if (typeof jid !== 'string' || !JID_RE.test(jid)) {
        return res.status(400).json({ error: 'invalid_jid' });
      }
      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'empty_text' });
      }
      if (text.length > MAX_SEND_CHARS) {
        return res.status(413).json({ error: 'text_too_long', max: MAX_SEND_CHARS });
      }

      const diagnostics = require('../lib/diagnostics');
      const sock = diagnostics.getRuntimeContext()?.sock;
      if (!sock) {
        return res.status(503).json({ error: 'socket_unavailable' });
      }
      const cs = require('../services/connectionState');
      if (!cs.isConnected()) {
        return res.status(503).json({ error: 'not_connected' });
      }

      // sock.sendMessage is wrapped by the outbound send queue in worker.js,
      // so this respects processing.sendConcurrency automatically.
      const sent = await sock.sendMessage(jid, { text });

      try {
        require('../services/adminAuditService').record({
          actor_jid: 'dashboard',
          chat_jid: jid,
          cmd_name: 'dashboard:send',
          prefix: '',
          args: text.slice(0, 180),
          kind: 'admin',
          outcome: 'ok',
        });
      } catch (_) {
        /* audit failure must never fail the send */
      }

      res.json({
        success: true,
        id: sent?.key?.id || null,
        jid,
        ts: sent?.messageTimestamp || null,
      });
    } catch (e) {
      try {
        require('../services/adminAuditService').record({
          actor_jid: 'dashboard',
          chat_jid: req.body?.jid || null,
          cmd_name: 'dashboard:send',
          prefix: '',
          args: String(req.body?.text || '').slice(0, 180),
          kind: 'admin',
          outcome: 'failure',
        });
      } catch (_) {
        /* ignore */
      }
      next(e);
    }
  });

  // ── Status / Stories ──────────────────────────────────────────────────
  //
  // Read-only projections over data already being collected:
  //   statuses  → messages WHERE jid='status@broadcast'
  //   views     → message_receipts WHERE jid='status@broadcast'
  // (Baileys emits message-receipt.update for status broadcasts — see
  // messages-recv.js:1186 — and EchoFox already records those.)
  //
  // Responses are grouped by LOCAL calendar day so the UI can render
  // "No status/story today" without doing date maths on the client.
  app.get('/api/statuses', async (req, res, next) => {
    try {
      if (typeof store.listStatuses !== 'function') {
        return res.json({ success: true, days: [], total: 0, unavailable: true });
      }

      const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      const limit = Math.min(Number(req.query.limit) || 500, 2000);

      const raw = store.listStatuses({ since, limit });
      const items = raw && typeof raw.then === 'function' ? await raw : raw;

      // Bucket by local date (YYYY-MM-DD).
      const byDay = new Map();
      for (const it of items) {
        const d = new Date(it.ts * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate(),
        ).padStart(2, '0')}`;
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(it);
      }

      // Emit every day in the window, newest first, so the UI can show
      // "No status/story today" as an explicit empty day.
      const out = [];
      for (let i = 0; i < days; i += 1) {
        const d = new Date(Date.now() - i * 86400 * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate(),
        ).padStart(2, '0')}`;
        const dayItems = byDay.get(key) || [];
        out.push({
          date: key,
          items: dayItems,
          count: dayItems.length,
          mine: dayItems.filter((x) => x.fromMe).length,
          totalViews: dayItems.reduce((n, x) => n + (x.viewCount || 0), 0),
        });
      }

      res.json({ success: true, days: out, total: items.length, windowDays: days });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/statuses/:id/viewers', async (req, res, next) => {
    try {
      if (typeof store.getStatusViewers !== 'function') {
        return res.json({ success: true, viewers: [] });
      }
      const viewers = store.getStatusViewers(req.params.id, 500);
      res.json({ success: true, id: req.params.id, viewers, count: viewers.length });
    } catch (e) {
      next(e);
    }
  });

  // ── v1.2.0 AI routes ──────────────────────────────────────────────────
  app.get('/api/ai/stats', async (req, res, next) => {
    try {
      if (typeof store.getAiUsageByDay !== 'function')
        return res.status(404).json({ error: 'not_implemented' });
      const days = Math.max(1, Math.min(180, Number(req.query.days) || 30));
      const rows = await store.getAiUsageByDay(days);
      const today = new Date().toISOString().slice(0, 10);
      const todayUsd =
        typeof store.getAiUsageDayTotal === 'function' ? await store.getAiUsageDayTotal(today) : 0;
      res.json({ days, rows, todayUsd, costCapPerDayUsd: config.ai?.costCapPerDayUsd || 0 });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/ai/chats', async (_req, res, next) => {
    try {
      if (typeof store.listAiOptedInChats !== 'function')
        return res.status(404).json({ error: 'not_implemented' });
      const rows = await store.listAiOptedInChats(200);
      res.json({ count: rows.length, chats: rows });
    } catch (e) {
      next(e);
    }
  });

  // v1.17.0 — admin audit log endpoints
  app.get('/api/audit', async (req, res, next) => {
    try {
      const days = Math.max(1, Math.min(3650, Number(req.query.days) || 7));
      const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 100));
      const offset = Math.max(0, Math.min(100000, Number(req.query.offset) || 0));
      const actor = req.query.actor ? String(req.query.actor) : null;
      const cmd = req.query.cmd ? String(req.query.cmd) : null;
      const sinceSec = Math.floor(Date.now() / 1000) - days * 86400;
      let events = [];
      if (actor && typeof store.listAdminAuditByActor === 'function') {
        events = await store.listAdminAuditByActor(actor, { sinceSec, limit });
      } else if (cmd && typeof store.listAdminAuditByCmd === 'function') {
        events = await store.listAdminAuditByCmd(cmd, { sinceSec, limit });
      } else if (typeof store.listAdminAudit === 'function') {
        events = await store.listAdminAudit({ sinceSec, limit, offset });
      }
      const total =
        typeof store.countAdminAudit === 'function' ? await store.countAdminAudit() : events.length;
      res.json({ days, limit, offset, actor, cmd, total, events });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/audit/status', async (_req, res, next) => {
    try {
      const adminAudit = require('../services/adminAuditService');
      const status = adminAudit.getStatus();
      const total = typeof store.countAdminAudit === 'function' ? await store.countAdminAudit() : 0;
      res.json({ ...status, total });
    } catch (e) {
      next(e);
    }
  });

  // v1.16.0 — leaderboard (top users by XP earned, active since)
  app.get('/api/leaderboard', async (req, res, next) => {
    try {
      const days = Math.max(1, Math.min(365, Number(req.query.days) || 7));
      const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 10));
      const sinceSec = Math.floor(Date.now() / 1000) - days * 86400;
      let rows = [];
      if (typeof store.getActiveUsersSince === 'function') {
        rows = await store.getActiveUsersSince(sinceSec, limit);
      } else if (typeof store.getTopUsersByXp === 'function') {
        rows = await store.getTopUsersByXp(limit);
      }
      res.json({ days, limit, generatedAt: Math.floor(Date.now() / 1000), users: rows });
    } catch (e) {
      next(e);
    }
  });

  // v1.16.0 — most-changed-groups card on Overview
  app.get('/api/stats/most-changed-groups', async (req, res, next) => {
    try {
      const days = Math.max(1, Math.min(365, Number(req.query.days) || 7));
      const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 5));
      const sinceSec = Math.floor(Date.now() / 1000) - days * 86400;
      let groups = [];
      if (typeof store.getMostChangedGroupsSince === 'function') {
        groups = await store.getMostChangedGroupsSince(sinceSec, limit);
      }
      // Enrich with subject for nicer display
      const enriched = await Promise.all(
        groups.map(async (g) => {
          let subject = null;
          try {
            const meta = await store.getGroupMetadata(g.jid);
            subject = meta?.subject || null;
          } catch {
            /* ignore */
          }
          return { ...g, subject };
        }),
      );
      res.json({ days, limit, generatedAt: Math.floor(Date.now() / 1000), groups: enriched });
    } catch (e) {
      next(e);
    }
  });

  // v1.16.0 — field-scoped settings history (filter dropdown)
  app.get('/api/groups/:jid/settings/history', async (req, res, next) => {
    try {
      const jid = req.params.jid;
      const field = req.query.field ? String(req.query.field) : null;
      const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 200));
      let events = [];
      if (field && typeof store.getGroupSettingsHistoryByField === 'function') {
        events = await store.getGroupSettingsHistoryByField(jid, field, limit);
      } else if (typeof store.getGroupSettingsHistory === 'function') {
        events = await store.getGroupSettingsHistory(jid, limit);
      }
      res.json({ jid, field, events });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/ai/config', (_req, res) => {
    const ai = config.ai || {};
    // Never expose API keys via the dashboard.
    const safe = {
      enabled: !!ai.enabled,
      defaultProvider: ai.defaultProvider,
      model: ai.model,
      persona: ai.persona,
      memoryTurns: ai.memoryTurns,
      maxTokens: ai.maxTokens,
      costCapPerDayUsd: ai.costCapPerDayUsd,
      optInDefault: ai.optInDefault,
      enableToolCalling: ai.enableToolCalling,
      typingWhileGenerating: ai.typingWhileGenerating,
      toolWhitelist: ai.toolWhitelist || [],
      rateLimitPerUserPerHour: ai.rateLimitPerUserPerHour,
      rateLimitPerChatPerDay: ai.rateLimitPerChatPerDay,
      providersConfigured: {
        openai: !!ai.providers?.openai?.apiKey,
        gemini: !!ai.providers?.gemini?.apiKey,
        anthropic: !!ai.providers?.anthropic?.apiKey,
        local: !!ai.providers?.local?.baseUrl,
      },
    };
    res.json(safe);
  });

  // ── Error handler ─────────────────────────────────────────────────────
  app.use((err, _req, res, _next) => {
    // Log the full error, return only a correlation id: driver messages can
    // embed connection strings, file paths or query fragments.
    const errId = crypto.randomUUID();
    logger.error({ err, errId }, 'dashboard route error');
    res.status(500).json({ error: 'internal', errId });
  });

  app.listen(port, () => {
    logger.info(
      { port, auth: !!config.dashboard.username, react: reactReady },
      'dashboard listening',
    );
  });
}

module.exports = { startDashboard };
