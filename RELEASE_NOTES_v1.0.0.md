# EchoFox v1.0.0 — First Stable Release 🦊

After months of iteration and a multiple-phase production-hardening cycle,
EchoFox is ready for stable use.

## Core Features

- **Production-grade WhatsApp bot** built on Baileys 7.x
- **5 subscription sources** (AlienVault, The Hacker News, RSS, GitHub releases + advisories, VirusTotal-watch)
- **4 store backends** (SQLite, Postgres, MongoDB, Redis) with full feature parity
- **React dashboard** with real-time metrics, subscription management, alerts
- **Soak-test toolkit** + runtime leak detector for long-running stability
- **90+ tests passing** across contract, boot, messages, and stores suites
- **Public API stable under SemVer** — breaking changes now require v2.0.0

## What's new in v1.0.0

### Soak testing (M6)
Three new scripts in `scripts/`:

```bash
node scripts/heap-snapshot.js                       # one-shot snapshot
node scripts/heap-diff.js before.snap after.snap    # class-level retention diff
node scripts/soak.js --durationMin=60 --rate=10     # synthetic load harness
```

Plus an always-on **runtime leak detector** that samples heap every 10 min,
keeps a rolling 24h window, and alerts on monotonic growth ≥30%.
Configurable via `runtime.leakDetection.*`.

### Dashboard polish
- New **HealthPill** component: live health-dot (green/red), version
  display, basic-auth-aware alert count
- New **SoakStatus** tile: current heap, leak-suspected indicator, uptime
- Refreshes every 5–30 s depending on data type

### Docs expansion (VitePress)
- [Subscriptions guide](docs/guide/subscriptions) — catalogue of all 5 sources
- [Dashboard guide](docs/guide/dashboard) — every tab + every API route
- [Soak Testing guide](docs/guide/soak-testing) — heap-snapshot + leak-detector workflow
- Bot Settings + Store & Auth references
- Reorganised sidebar: Getting Started → Features → Configuration → Architecture → Reference

## Upgrade from v0.4.x

1. `git pull && npm install`
2. `npm run build:dashboard` (or let it auto-build on boot)
3. `npm start`

Migrations run automatically. No config changes required.
Set `runtime.leakDetection.enabled: false` if you don't want the
leak detector (default: enabled).

## Public API guarantees

These APIs are now stable under SemVer:

- Store interface (all 4 backends): see `src/store/db.js` for the contract
- Subscription command shape: `on|add` / `off|remove` / `-status` / `help`
- Event router contract: `emit(eventName, payload)` → bus handlers
- Dashboard `/api/*` routes: JSON responses, Basic-auth, `{ error, message }` on failure
- `network.axiosWithBreaker(name, axiosCfg, opts?)` + `isOpenBreakerError(err)`


## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).

---
