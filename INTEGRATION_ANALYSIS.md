# EchoFox — Frontend ↔ Backend Integration Analysis

**Scope:** source analysis of the React dashboard (`dashboard/`) against the Express
dashboard server (`src/dashboard/server.js`) and the supporting worker/store layer,
with Baileys-7.x correctness cross-checked against the `baileys-skill` knowledge base.
**Date:** 2026-10-17 · **Repo state:** `arena/411a073f-echofox` @ `487f968` + working tree.

---

## 1. How the two sides connect (architecture map)

```
Browser (React SPA, dashboard/src)
  │  fetch() with `Authorization: Basic …` (in-memory, set by Login form)
  │  paths are origin-absolute: /api/…
  ├─ prod:  Express serves SPA + API from ONE origin (worker process, port 3001)
  └─ dev:   Vite :5173 (base /dashboard/) — proxy `/api` → localhost:3001
                    │
Express app (src/dashboard/server.js, started by src/core/worker.js
             **inside the `connection.update` → 'open' handler**)
  ├─ rateLimit instance "dashboardLimiter" mounted at /api, /dashboard, /
  ├─ basicAuth middleware (global, if config.dashboard.username set)
  ├─ ~45 /api routes → store (sqlite/mongo/pg/redis), metrics, diagnostics,
  │                    connectionState, adminAuditService, live `sock`
  └─ /metrics (Prometheus text) + static SPA under /dashboard
                    │
Worker process also owns: Baileys socket (`sock`), store instance,
connectionState module state — the dashboard reads these in-process. ✓
```

Verified invariants that are **correct**:
- Dashboard runs in the same process as the socket/store, so `connectionState` /
  `getRuntimeContext().sock` module state is shared — no cross-process bug.
- `getMessage`, `cachedGroupMetadata`, `makeCacheableSignalKeyStore`,
  `creds.update → saveCreds`, `msgRetryCounterCache` are all wired (Baileys best practice).
- Vite `base: '/dashboard/'` matches the Express mount; dev proxy port env
  (`ECHOFOX_DASHBOARD_PORT`) maps to `config.dashboard.port` via the
  `ECHOFOX_<SECTION>_<KEY>` scheme. All SPA fetches are `/api/*`, so the dev proxy
  covers 100% of current traffic.
- Frontend `tsc -b` is clean; every *live* page's response-shape handling matches its
  endpoint (items/total wrappers, `{users}`, `{active}`, `{viewers}`, etc.).
- `build-dashboard.js` output (`src/dashboard/react/`) matches `REACT_DIR` in
  `server.js`; build-on-boot + maintenance page path is coherent.

---

## 2. Issues found

### 🔴 C1 — The rate limiter double-counts every API call, and the dashboard's own polling budget exceeds the cap → the UI bricks itself after ~7–12 minutes

**Where:** `src/dashboard/server.js:114-140`, `dashboard/src/components/HealthPill.tsx:67-68`

One `rateLimit` instance (300 req / 15 min / IP) is mounted **three times**:
`app.use('/api', …)` (line 121), `app.use('/dashboard', …)` (line 122),
`app.use('/', …)` (line 140). A request to `/api/*` matches both the `/api` and the
`/` mount, so the middleware runs **twice per request**. Empirically verified with
`express-rate-limit@7` + `express@4`: three GETs to `/api/ping` return
`RateLimit-Remaining: 298, 296, 294` — each request costs **2** credits.
The effective budget for API traffic is therefore **150 requests / 15 min**.

Meanwhile the always-mounted header pill polls `/api/health` every **5 s** (12 req/min)
and `/api/alerts` every **10 s** (6 req/min) = 18 req/min → 270 req/15 min →
**540 increments**, blowing the 300 cap in ≈7.5 minutes with no tab open.
Tabs add more (Overview: stats @15 s + SoakStatus @30 s = 6 req/min; Chat with a
conversation open: 8 req/min; Presence: 6 req/min …).

Once the window is exhausted **everything** on the limiter429s — API, the SPA shell at
`/dashboard`, even the login page — surfacing as "Failed to fetch data" everywhere
until the 15-minute window rolls. This is the single most damaging integration defect.

**Fix (pick one or combine):**
1. Mount the limiter **once** (e.g. `app.use(dashboardLimiter)` only) or give `/`,
   `/dashboard` static, and `/api` separate instances — never the same instance twice.
2. Re-do the budget math for the UI's polling design (HealthPill alone needs ~270/15min
   *with single counting*), or
3. Slow the pill to 30–60 s, share one poller across components (a tiny event emitter /
   SWR-style cache), or move to SSE/WebSocket push (Vite dev proxy would need
   `ws: true` for that).

---

### 🔴 C2 — `fetchJson` throws on every non-2xx, so the server's *degraded* payloads (503 + JSON body) can never reach the UI

**Where:** `dashboard/src/lib/api.ts:20-42`, `src/dashboard/server.js:227` (health),
`src/dashboard/server.js:454-457` (diagnostics), `dashboard/src/pages/Diagnostics.tsx:37-45`,
`dashboard/src/components/HealthPill.tsx:53-58`

The server deliberately answers **503 + a rich JSON body** when things are degraded:
- `/api/health` → `{ ok:false, degraded, checks:{store, loginConnected, …}, backends }`
- `/api/diagnostics` → full report with `ok:false` and per-check results

But `fetchJson` does `if (!res.ok) throw` and only skims `body.error` for the message,
discarding the payload. Consequences:
- `Diagnostics.tsx` renders `report.ok ? "✅ Healthy" : "❌ Degraded"` — that branch is
  **unreachable**: a degraded system throws before `setReport`, and the page shows
  "Failed to load diagnostics." precisely when the report matters.
- `HealthPill` maps any failure to a bare red "down" dot; the `checks`/`backends`
  detail the server prepared is thrown away.

**Fix:** in `fetchJson`, parse the error body and reject (or resolve) with it — e.g.
`throw new ApiError(res.status, body)` where `ApiError` keeps `.body` — and let
Diagnostics/HealthPill read `err.body` on 503. (Alternatively return `{status, body}`
for 503 endpoints specifically.)

---

### 🔴 C3 — Login is never validated against the backend, and there is no 401 recovery path

**Where:** `dashboard/src/App.tsx:54-57`, `dashboard/src/lib/api.ts:7-16`

`handleLogin` calls `setAuth(username, password)` and `setIsAuthenticated(true)` with
**zero round-trips**. Any credentials "work" in the UI; a typo means every poll fails
silently with generic "Failed to fetch data" strings — `fetchJson` collapses status
into a message, so no page can distinguish 401 (bad auth) from 503/outage.

Additional quirks:
- `authHeader` is a module-level `let` — a page reload forgets the session and shows
  Login again, while the browser's native Basic-auth cache (populated by the
  `WWW-Authenticate` dialog the server triggers on the very first document request)
  may still attach its *own* Authorization header to fetches. Two overlapping auth
  mechanisms (browser dialog + in-app form), potentially with different credentials;
  the in-app header always wins and can be the wrong one.
- `credentials: "include"` is vestigial (no cookie sessions exist).

**Fix:** `handleLogin` should call `getHealth()` (or a cheap `/api/version`) *before*
`setIsAuthenticated(true)` and show the error on failure; have `fetchJson` reject with
a typed `status` so the app can react to 401 (clear auth + show Login). Consider
dropping the SPA form (rely on the browser dialog) or, better, a real session cookie
and no `WWW-Authenticate` on the HTML shell.

---

### 🟠 H1 — Dashboard send writes an audit outcome outside the audit contract

**Where:** `src/dashboard/server.js:824` (`outcome: 'ok'`), contract at
`src/services/adminAuditService.js:70`, `src/store/migrations/sqlite/010_admin_audit.js:27`,
`dashboard/src/lib/api.ts` `AuditEvent.outcome: "success" | "failure" | "timeout" | "denied"`.

Every other writer uses `'success' | 'failure' | 'timeout' | 'denied'`
(`commandRunner.js`, `messages.upsert.js` for denials). The dashboard's
`POST /api/conversations/send` is the only producer of `'ok'`, which:
- violates the documented union (the TS type literally cannot represent it),
- renders in `AuditLog.tsx` as an unstyled chip (`OUTCOME_CLS['ok']` → `""`).

**Fix:** `outcome: 'success'` (and `'failure'` on the catch block is already typed fine).

---

### 🟠 H2 — The Chat composer can target JIDs the send endpoint rejects

**Where:** `src/dashboard/server.js:764` (`JID_RE`), `dashboard/src/pages/Chat.tsx:80-95`

`getChats` returns every row of `contacts ∪ chats` — including `@newsletter` JIDs and
`status@broadcast` — but the send endpoint only accepts
`\d+@s.whatsapp.net | \d+@g.us | \d+@lid`. The left-hand contact list applies **no
filter**, so selecting a newsletter/status row and sending yields
`API Error: 400 (invalid_jid)` with no guidance. (Device-qualified JIDs like
`123:2@s.whatsapp.net` would also fail the regex.)

**Fix:** filter the Chat list to `s.whatsapp.net|g.us|lid` client-side (the endpoint's
contract is fine), and surface `body.error` in the composer's error state.

---

### 🟠 H3 — Overview tab is half-wired: hardcoded mock chart, dead "—" cards, orphaned real-data components

**Where:** `dashboard/src/pages/Overview.tsx:74-103`, `dashboard/src/components/MostChangedGroups.tsx`,
`dashboard/src/components/RecentActivity.tsx`, `src/dashboard/server.js` `/api/stats/most-changed-groups`

- `messageTrend` is a **hardcoded literal** (`[{time:"00:00",sent:120,…}]`) fed to
  `MessageTrendChart` — fake data presented as "Message volume — last 24 hours".
- The five `MetricCard`s render literal `"—"` placeholders despite `/api/stats`
  carrying real counters/gauges.
- `MostChangedGroups.tsx` + its API helper `getMostChangedGroups` (commented
  "Overview most-changed-groups card") and `RecentActivity.tsx` are **never imported**
  by any page — while the server implements `/api/stats/most-changed-groups` for them.

**Fix:** wire the cards to `data.counters`/`data.gauges`, mount `MostChangedGroups`
in the Overview grid, and drop or implement the trend chart against real message
counters (e.g. `messages_received_total`-style series from the store).

---

### 🟠 H4 — The dashboard server only comes up *after* the WhatsApp connection opens

**Where:** `src/core/worker.js:408-448` (`connection.update` → `'open'` handler),
`src/dashboard/server.js:1088` (`app.listen` with no `'error'` handler)

`startDashboard` is invoked inside `if (connection === 'open')`. Consequences:
- On a fresh install / logged-out session (QR pairing phase) **no dashboard exists** —
  and the dashboard has no pairing UI anyway (QR is terminal-only).
- When the WA socket is down (network loss, `loggedOut`, crash-looping auth), the
  dashboard — the tool you'd use to *debug* that state — is unreachable.
- If `startDashboard` throws (e.g. `EADDRINUSE`), `dashboardStarted` is only set on
  success but the error is merely logged and never retried; `app.listen` has no
  `error` listener, so a bind failure becomes an unhandled `'error'` event that can
  take the whole worker down → supervisor restart loop.

**Fix:** start the dashboard in `bootstrap`/worker startup (before/parallel to socket
creation — it only needs `store` + `config`, with sock-dependent routes already
guarding `getRuntimeContext()?.sock`), attach `server.on('error', …)`, and retry or
fail loudly on bind errors.

---

### 🟡 M1 — `/api/audit` `total` ignores the active filters

**Where:** `src/dashboard/server.js:969`

`events` are filtered by `actor`/`cmd`/window, but `total` is a global
`countAdminAudit()`. `AuditLog.tsx` pagination math against `total` is wrong whenever
a filter is applied.

**Fix:** pass the filter into the count query (`countAdminAudit({sinceSec, actor, cmd})`)
or return `total = events.length` for filtered views.

---

### 🟡 M2 — `getStatusViewers` is un-awaited (sqlite-only assumption)

**Where:** `src/dashboard/server.js:917`

`const viewers = store.getStatusViewers(...)` is not awaited and no thenable guard is
used (unlike `listStatuses`/`listMessages` which handle both). Only `sqliteStore`
implements it, synchronously, so it works today; any async implementation (mongo/pg/redis
don't implement it at all — those users silently get `[]`) would serialize a Promise as
`{}` and `count: undefined`.

**Fix:** `const viewers = await Promise.resolve(store.getStatusViewers(...))`.

---

### 🟡 M3 — `/api/health` "fallbacks" lie under failure

**Where:** `src/dashboard/server.js:178-181` (`catch { checks.loginConnected = true }`),
`src/dashboard/server.js:207-217` (`lastMsgAgoSec = u < 60 ? null : null` placeholder)

If `connectionState` throws, health reports `loginConnected: true`. The
`lastMsgAgoSec` branch is dead code that always yields `null`. Small, but this is an
endpoint whose whole job is truth-telling during incidents.

---

### 🟡 M4 — Dead / orphaned frontend artifacts imply missing wiring

| Artifact | Status |
|---|---|
| `hooks/useRealTime.ts` | Never imported. Also buggy: `[fetchFn, intervalMs]` dep re-runs the effect on every render when an inline lambda is passed (fetch → state → render → new fn → re-run loop), and `setError` is never cleared on recovery. |
| `components/chats/ChatDetail.tsx` | Never imported. Its prop shape (`contact/presence/stats/commands/enrichment`) is exactly the response of **`GET /api/chats/:jid/full`** — a server endpoint with no frontend caller. The Chats drill-down was never connected. |
| `components/RecentActivity.tsx`, `components/MostChangedGroups.tsx` | Never imported (see H3). |
| `api.ts` exports with no callers | `getContact`, `getChat`, `getChatPresence`, `getPresence`, `getChatLabels`, `getLidMapping`, `getNewsletterReactions`, `getGroupSettingsHistoryFiltered` (documented as intentionally optional in `SettingsHistory.tsx`). |

**Fix:** either wire `ChatDetail` to `/api/chats/:jid/full` from `Chats.tsx` (the
backend is ready) or delete both sides; delete or fix `useRealTime`; prune unused
exports.

---

### 🟡 M5 — Contact photos render directly from WhatsApp CDN URLs

**Where:** `dashboard/src/pages/Chats.tsx` (`<img src={chat.imgUrl}>`),
`src/events/contacts.upsert.js` (stores Baileys `imgUrl` verbatim)

WhatsApp profile-picture URLs are auth-scoped and expire; in a browser they typically
403/410. The `<img>` has no `onError` fallback, so tiles show broken images instead of
the letter-avatar the same component already renders for `null`.

**Fix:** `onError` → hide the img (fall back to the avatar div), or proxy/cache avatars
through the backend.

---

### 🔵 L1 — Deployment caveats (config-level, worth knowing)

- **Basic auth gates `/metrics` too** (`server.js:143` is global). Prometheus must send
  credentials (`.env.example` documents this for the `observability` profile — OK, but
  any unauthenticated scraper gets 401).
- **`trust proxy: 'loopback'`** is correct for host-published ports, but if a reverse
  proxy runs in another container, the peer IP is the bridge IP — `X-Forwarded-For` is
  then ignored and **all users share one rate-limit bucket**. Use `1` or a CIDR in
  that topology (the code comments already warn against `true`).
- The supervisor (`bootstrap.js`, `:3000`) and the dashboard (`:3001`) are separate
  HTTP surfaces; on worker restart the dashboard blips down (no static fallback).
- `express.json({ limit: '64kb' })` only affects the single POST route — fine.

---

## 3. Endpoint coverage matrix (frontend `api.ts` ↔ Express)

All 33 helpers in `dashboard/src/lib/api.ts` resolve to existing routes; response
shapes checked against store output for the live pages (`items/total`, `{users}`,
`{active}`, `{viewers}`, `{counters,gauges,startedAt}`, `{days,…}` statuses grouping,
audit `{events,total}`). **No missing-route bugs.** The gaps are the *dead* pairs
listed in M4 (server `/api/chats/:jid/full` without a client, `ChatDetail` without a
fetcher) and the contract mismatches C2/H1/H2 above.

Not covered by the dashboard at all (by design or neglect): pairing/QR, message media
bodies (documented as out of scope in `Chat.tsx`), blocklist mutation, group admin
actions — all read-only except `POST /api/conversations/send`.

---

## 4. Priority fix list

| # | Issue | Severity | Effort |
|---|---|---|---|
| C1 | Rate-limiter double-mount + polling budget | Critical | S–M |
| C2 | `fetchJson` discards 503 payloads | Critical | S |
| C3 | Login not validated, no 401 recovery | Critical | S |
| H1 | audit `outcome: 'ok'` | High | S |
| H2 | Chat list vs `JID_RE` | High | S |
| H3 | Overview mock data / dead cards | High | M |
| H4 | Dashboard lifecycle tied to WA `open` | High | S–M |
| M1–M5 | filters, awaits, dead code, avatars | Medium | S–M |

C1–C3 + H1 + H2 are small, surgical changes with outsized user impact: together they
explain the likely observed symptoms ("dashboard randomly stops loading", "diagnostics
always says failed", "chat send sometimes says invalid_jid", "audit log shows weird
OK chip").
