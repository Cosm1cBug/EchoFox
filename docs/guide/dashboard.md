# Dashboard

EchoFox ships with a React-based dashboard for observability + subscription
management.

## Starting the dashboard

The dashboard auto-starts when `config.dashboard.enabled === true`.
Default URL:

```text
http://localhost:3001/dashboard/
```

Visiting `http://localhost:3001/` (the root) redirects to `/dashboard/`.

## Authentication

Basic-auth protected — credentials come from:

```js
// src/config.js
dashboard: {
  enabled:  true,
  port:     3001,
  username: 'admin',
  password: 'change-me-please',
},
```

> ⚠️ **Set a strong password.** The dashboard exposes group metadata,
> message timeline endpoints, and subscription details. If
> `username` is empty, auth is disabled entirely (the bot logs a
> warning at boot — do NOT expose publicly).

## Tabs

### Overview
- Top commands by invocation count
- Message volume trend
- Recent activity feed
- Soak status tile (v1.0.0+)
- Auto-refreshes every 15 seconds

### Groups
- All groups the bot is in
- Click a group → participant list, event history, deleted-message
  count, group metadata

### Metrics
- Raw counters + gauges dump (Prometheus-compatible naming)
- Useful when wiring up external monitoring

### Diagnostics
- Per-subsystem health check (Baileys, store, commands, auth, host)
- Latency per check
- Overall: ✅ OK / ❌ DEGRADED

### Alerts
- Active command-failure alerts from the alert engine
- Failure rate, invocation count, since-when

### Subscriptions (v0.4.7+)
- Per-service tables (🛡️ AlienVault, 📰 The Hacker News, 📡 RSS, 🐙 GitHub, 🦠 VT-Watch)
- Subscriber JID, topic-filter chips, last-delivery timestamp
- Refreshes every 15 s

## Header (v1.0.0+)

The new header has a live **HealthPill** with:
- Green/red status dot tied to `/api/health`
- Uptime (`up · 2d 4h`)
- Version + backend tag (`v1.0.0 · SQLITE/MULTIFILE`)
- 🚨 Alert count (only shows if > 0)

## Build-on-boot

If `src/dashboard/react/` is missing when the bot starts,
`startDashboard()` automatically runs `npm run build:dashboard` once.
If the build fails, the bot serves a maintenance page instead of
crashing. Run the build ahead of time to skip this step on first boot:

```bash
npm run build:dashboard
```

## Dev workflow (HMR)

For React development with hot reload, run Vite directly:

```bash
cd dashboard
npm run dev
```

Vite serves on `:5173` and proxies `/api/*` to the bot's dashboard
server on `:3001` automatically (configured in `vite.config.ts`).

## API routes

All routes live under `/api/*` and require the same basic auth.

| Route | Returns |
|---|---|
| GET `/api/health` | uptime, version, backend list |
| GET `/api/stats` | full metrics snapshot (counters + gauges) |
| GET `/api/groups` | list of groups |
| GET `/api/groups/:jid` | full group metadata |
| GET `/api/groups/:jid/participants` | current participants |
| GET `/api/groups/:jid/participants/history?limit=200` | event history |
| GET `/api/messages/:jid/:id/edits` | message edit history |
| GET `/api/messages/:jid/:id/reactions` | reaction history |
| GET `/api/messages/:jid/:id/receipts` | delivery receipts |
| GET `/api/groups/:jid/deleted` | deleted-message log |
| GET `/api/diagnostics` | health-check report |
| GET `/api/alerts` | active alerts |
| GET `/api/alerts/:cmd` | failure rate for one command |
| GET `/api/subscriptions` | per-service subscribers + meta |

All routes return JSON. Errors return `{ error, message }` with the
appropriate HTTP status.
