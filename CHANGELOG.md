# Changelog

All notable changes to EchoFox will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- CI/CD with auto-release on tag 
- VitePress docs site at cosm1cbug.github.io/echofox 


---

## [1.0.2] — 2026-06-09

> **Hotfix release.** Addresses 4 latent crash bugs surfaced by deeper
> audit + lint analysis. No functional or API changes; safe drop-in
> upgrade from v1.0.1.

### Fixed — crash bugs

- **Dashboard server crashed at boot** — v1.0.1's manual patch of
  `src/dashboard/server.js` left both the corrected rate-limiter block
  AND the broken original side-by-side, causing
  `SyntaxError: Identifier 'dashboardLimiter' has already been declared`
  on every startup with `dashboard.enabled: true`. Orphan block removed.
- **`auth.js` crashed for Redis/SQLite/Postgres auth backends** —
  `makeCacheableSignalKeyStore` was referenced in 3 places but never
  imported from `@whiskeysockets/baileys`. `log` was referenced but
  never declared at module level. Default `MULTIFILE` auth was unaffected
  (didn't hit these code paths). Now correctly imported + module-level
  logger added.
- **Worker crashed on Baileys reconnection** — `MAX_RECONNECT_ATTEMPTS`
  was referenced in the reconnect-loop logic but never declared.
  `ReferenceError` on first reconnect attempt after a disconnect.
  Now declared as a `const` (10 attempts) at the appropriate scope.
- **`newsletter.upsert.js` crashed on every newsletter event** — two
  bugs in 2 lines: handler destructured `{ sock, newsletter }` but the
  router emits `{ sock, u }`, and the log call referenced an undeclared
  `newsletters` variable. Now correctly handles both single-newsletter
  and array payloads.

### Test coverage

- All 90/90 tests still pass (36 contract + 19 boot + 24 messages + 11 stores).
- ESLint errors dropped from 10 → 1 (only `mediafire.js` sparse-array
  warning remains; pre-existing, non-crashing, flagged for v1.1.0).

### Backward compatibility

Fully backward compatible with v1.0.1:
- No config schema changes
- No store interface changes
- No `/api/*` route changes
- No command behaviour changes

### Operational notes

- Just `git pull && npm install && npm start`. No lock-file regeneration
  needed since no `package.json` deps changed.
- **If you were on v1.0.1 with `dashboard.enabled: true`** — your bot
  was crashing at boot. This release fixes that.
- **If you were using Redis/SQLite/Postgres auth on v1.0.0–v1.0.1** —
  you were getting a crash at auth setup. This release fixes that.
- **If you ever experienced a Baileys disconnect** (which is normal) —
  the worker was crashing on retry. This release fixes that.

---

## [1.0.1] — 2026-06-09

> **Hotfix release.** Addresses 3 issues introduced or surfaced in
> v1.0.0, plus resilience hardening across all subscription services
> and external-API commands. No breaking changes — safe upgrade from
> v1.0.0.

### Fixed

- **Dashboard server crashed at boot** — the v1.0.0 rate-limit
  "Autofix" added `require('express-rate-limit')` to
  `src/dashboard/server.js` without adding the package to
  `package.json`. Bot crashed at boot with `Cannot find module
  'express-rate-limit'` whenever `dashboard.enabled: true`. Now declared as
  a direct dependency (`^7.4.1`).
- **Rate limiter mounted on the wrong path** — the Autofix applied
  the limiter to `/dashboard` (static React files) instead of `/api/*`
  (the actual data endpoints) and placed it *after* basic-auth so
  brute-force auth attempts weren't throttled. Now applies to BOTH
  `/api` and `/dashboard`, mounted BEFORE basic-auth, with a more
  realistic limit (300 req per 15-min window vs the previous 100).
- **`sqliteStore.js` had 4 duplicate method definitions** —
  `getMessageEdits`, `getMessageReactions`, `getMessageReceipts`,
  `getDeletedInGroup` were each defined twice, with the first
  (Promise-wrapped) versions being dead code overwritten by the second
  (synchronous) versions. ESLint failed with 4 `no-dupe-keys` errors
  blocking `npm run lint` in CI. Dead Promise wrappers removed.
- **Phase 5 newsletter event mismatch fix** — confirmed shipped in
  `bus.on('newsletters.update', ...)` (plural). No regression.

### Security

- **Eliminated 21 transitive `axios` CVEs** from
  `wa-sticker-formatter@4.4.4` (which bundles `axios@0.21.4`). Added an
  `npm overrides` block to force the bundled axios up to the project's
  direct `axios@^1.7.7`. Confirmed via `npm audit`: 0 axios CVEs
  remaining (was 21: 4 high, 11 moderate, 6 low/incl. SSRF, prototype
  pollution, header injection, ReDoS, NO_PROXY bypass).
- **Brute-force auth surface now rate-limited** — the new
  `/dashboard` + `/api` limiter sits before basic-auth, so credential
  guessing is throttled at 300 attempts per 15-min window per IP.

### Changed — resilience

All 10 remaining direct-axios callers now use the v0.4.6
`axiosWithBreaker` pattern with per-upstream circuit breakers. When
an upstream is failing, the breaker opens and the service skips that
cycle gracefully (returns empty array / `null`) instead of piling up
timed-out sockets. Users get a friendly "service overloaded" message
instead of stack traces.

Service breakers added:
- `alienvault` — AlienVault OTX
- `thehackersnews` — The Hacker News RSS
- `rss:<hostname>` — per-host breakers for the generic RSS service
- `github:owner/repo/releases` — per-repo GitHub releases
- `github:owner/repo/advisories` — per-repo GitHub advisories
- `vtwatch:<type>` — VirusTotal verdict watch (per type: hash/ip/domain/url)

Command breakers added:
- `virustotal` — `.virustotal` lookup command
- `aptoide-search`, `aptoide-info` — `.apkdl` command
- `pinterest-search` — `.pinterest` command
- `zenquotes` — `.quote` command
- `ssweb` — `.ssweb` command

Direct axios still used for one-shot binary downloads
(`apkdl` icon, `pinterest` image fetch) where breaker overhead
isn't beneficial.

### Test coverage

- All 90/90 tests still pass (36 contract + 19 boot + 24 messages + 11 stores).
- No new tests added in this hotfix; breaker behaviour is tested
  upstream in `src/lib/circuitBreaker.js`'s own test suite.
- ESLint errors dropped from 13 → 9 (the 4 sqliteStore duplicate-key
  errors removed; remaining 9 are pre-existing issues in
  `mediafire.js`, `auth.js`, `worker.js`, `newsletter.upsert.js` —
  flagged for v1.1.0 cleanup).

### Backward compatibility

Fully backward compatible with v1.0.0:
- No config schema changes
- No store interface changes
- No `/api/*` route changes
- No command signature changes

### Operational notes

- Run `del package-lock.json && npm install` after pulling to ensure
  the new `overrides` block takes effect (npm 8.3+ honours overrides,
  but a stale lockfile can re-pin the old transitive deps).
- New env var override available: none (no config changes).
- The rate-limit defaults (300 req / 15 min) should suit normal
  dashboard usage; tune via reverse proxy if you have specific needs.

---

## [1.0.0] — 2026-06-09

> **First stable release.** Drops the `-beta` suffix after the v0.4.x
> production-hardening cycle. SemVer commitments are now in effect —
> all public APIs in this release are considered stable.

### Public API surface (now stable under SemVer)

- **Store interface** (`src/store/db.js` contract) — `getSubscribers`,
  `addSubscriber`, `removeSubscriber`, `isSubscriber`,
  `getSubscriberMeta`, `updateSubscriberMeta`,
  `updateSubscriberTimestamp`, `hasSentItem`, `recordSentItem`
  (+ legacy aliases `hasSentArticle`/`recordSentArticle`).
  Implemented by all 4 backends with identical semantics.
- **Network helpers** — `network.axiosWithBreaker(name, axiosCfg, breakerOpts?)`
  and `network.isOpenBreakerError(err)`.
- **Config loader** — `__testOverride(obj)`, `__resetForTests()`,
  `__getCurrent()` are test-only and clearly marked.
- **Subscription command shape** — every subscription command supports
  `on|add` / `off|remove` / `-status`|`status`|`list` / `help`.
- **Event router contract** — `worker.emit('event.name', payload)` is the
  only way events reach handlers; payload shape is per-event-handler.
- **Dashboard `/api/*` routes** — every route returns JSON; auth via
  HTTP Basic; errors return `{ error, message }`.

Breaking changes after v1.0.0 will require a v2.0.0 release.

### Added — v1.0.0 (M6 + final polish)

- **Soak-test toolkit** in `scripts/`:
  - `heap-snapshot.js` — one-shot v8 heap snapshot to disk
  - `heap-diff.js` — class-level retention growth between two snapshots
  - `soak.js` — synthetic load harness (configurable duration / rate / snapshot cadence)
- **Runtime leak detector** in `src/lib/leakDetector.js` — rolling 24h
  heap-sample window, alerts on monotonic growth above a configurable
  threshold (default 30%). Wired into worker boot. Configured via
  `config.runtime.leakDetection.{enabled,sampleIntervalMs,windowSize,growthThresholdPercent}`.
- **Dashboard polish** — new `HealthPill` component (live health-dot,
  version display, alert count) and `SoakStatus` tile (heap trend +
  leak-suspected indicator). Header restyled.
- **VitePress docs expansion**:
  - new pages: Subscriptions guide, Dashboard guide, Soak Testing guide,
    Bot Settings reference, Store & Auth reference, Changelog
  - sidebar reorganised: Getting Started, Features, Configuration,
    Architecture, Reference

### Fixed — v1.0.0

- **Event router newsletter handler** was registered on `bus.on('newsletter.update')`
  but `worker.js` emits `'newsletters.update'` (Baileys 7.x canonical
  name). Phase 5's commit message claimed this fix but the actual edit
  was dropped — the symmetry test caught it during Phase 7 validation.
  Now correctly registered on the plural key.

### Highlights from the v0.4.x cycle (rolled up)

- v0.4.6: `axiosWithBreaker` wired into 5 commands; batched message
  writes for Postgres + Mongo; migration auto-run for all 4 backends;
  `configLoader.__testOverride`; Func.js slimmed; sqliteStore migration-runner
  bugfix; v0.4.6 launch.
- v0.4.7 (this beta cycle):
  - Phase 1: boot fix + groups.update dedupe + newsletters event wiring
  - Phase 2: React dashboard buildable + integrated (was: project couldn't even build)
  - Phase 3: subscription UX (status verb, topic filter, admin dashboard view)
  - Phase 4: event-routing cleanup — 26↔26 symmetry, no dead handlers, no silent drops
  - Phase 5: test coverage uplift — 54 → 76 tests (+22)
  - Phase 6: 3 new subscription sources (RSS, GitHub, VirusTotal-watch);
            table rename `thehackersnews_sent_articles` → `service_sent_items`
            via migration 002, with backward-compat method aliases

### Test coverage

- **All 76 tests pass** across 4 suites: contract (33), boot (16),
  messages (16), stores (11).
- Event-router symmetry tests guard against future regressions of the
  emit/handler mismatch class.

### Backward compatibility

- Old store methods `hasSentArticle` / `recordSentArticle` remain as
  aliases to the new `hasSentItem` / `recordSentItem` on all 4 backends.
- Old static dashboard at `/` redirects to `/dashboard/` (no broken bookmarks).
- Existing subscribers without `meta` are read as `meta: null`.

### Operational notes

- Migrations run automatically on boot by default. To run manually:
  `npm run migrate`.
- Dashboard rebuilds automatically on boot if `src/dashboard/react/`
  is missing.
- Leak detector is enabled by default — no action needed.

---

## [0.4.1-beta] — 2026-05-29

> **Reconciliation release.** Fixes 2 boot-time crashes, re-installs the M1
> OSS scaffolding that was lost in the squash, and harmonises the new
> pluggable auth / store / dashboard layers with the validated config
> loader.

### Fixed
- **🔴 BOOT CRASH** — `worker.js` imported `tempManager` from `../utils/`
  but the file lives at `src/lib/tempManager.js`. Path corrected.
- **🔴 RUNTIME CRASH** — `src/core/auth.js` referenced `proto.Message.AppStateSyncKeyData`
  without importing `proto`. Added to the destructure.
- **🟡 BINARY CORRUPTION** — `src/store/redisStore.js` used `setex(Buffer)`
  which doesn't preserve binary on all ioredis versions. Switched to
  `set(key, Buffer, 'EX', ttl)`.

### Added (restored from M1, lost in squash)
- `CHANGELOG.md`, `DISCLAIMER.md`, `SECURITY.md`, `NOTICE`, `CONTRIBUTING.md`
- `.github/FUNDING.yml`, `.husky/pre-commit` + `.husky/.gitignore`
- `src/lib/configLoader.js` + `src/lib/configSchema.js` — zod-validated config
- `src/config.example.js` — canonical template
- `src/core/commandRunner.js` — central command execution layer with timeouts,
  cooldowns, crash reporting, channel logging
- `src/commands/__tests__/contract.test.js` — duplicate-name / alias-collision
  / malformed-export checks
- AGPL-3.0 header on every source file (`npm run headers` to apply)

### Extended (config schema + loader)
- New schema sections recognised: `login`, `auth`, `storeDB`, `dashboard`,
  `processing`, `features.syncHistory`
- Pairing-code login: schema validates `login.phoneNumber` is required when
  `login.type === 'PAIRING'`
- Hybrid auto-translator: handles both legacy v5/v6 `options/WApp` shape
  AND your new `login/auth/storeDB` shape in the same file
- Env-var overrides extended to cover all new sections
  (`ECHOFOX_STOREDB_TYPE=POSTGRES`, `ECHOFOX_DASHBOARD_ENABLED=true`, …)

### Changed
- **`src/events/messages.upsert.js`** — now delegates command execution to
  `commandRunner.run()` for centralised timeout/crash handling. Also glues
  legacy `m.sender`, `m.from`, `m.reply`, `m.react`, etc. onto the raw
  message so 20+ existing commands keep working without edits.
- **`src/core/worker.js`** — removed the hand-rolled per-minute rate-limit
  Map (it was off-by-one and shared state with no eviction). Inbound rate
  limiting moved to a proper token-bucket in `middleware/rateLimit.js`,
  wired in `messages.upsert.js`. Outbound `sendMessage` queue now wired
  automatically after `connection === 'open'` (concurrency from
  `config.processing.sendConcurrency`, default 4).
- **`src/store/sqliteStore.js`** — added `recordStat()` and `getStats()`
  methods to match the new uniform store interface. Adds a `stats` table.
- **`package.json`** — `license` → `AGPL-3.0-or-later` (SPDX),
  `version` → `0.4.1-beta`, added missing scripts (`lint`, `format`,
  `headers`, `headers:check`, `docs:commands`, `test:contract`), added
  devDeps (`eslint`, `prettier`, `husky`, `lint-staged`, `zod`).

### Known issues (deferred to v0.4.2)
- Two commands share the name `.sticker` (`convert/sticker.js` + `convert/stk.js`)
  and two share `.ctx` (`general/ctx.js` + `misc/test.js`). Contract test
  catches this. Rename pending.

### Migration notes
- **No action required for your `src/config.js`** — auto-translated.
- New users start with `cp src/config.example.js src/config.js` for a clean
  template.
- `npm install` will pull `zod` (new dep). No other dep changes.
- Pre-commit hook installs on first `npm install` via `npm run prepare`.

---

## [0.4.0-beta] — 2026-05-29 (squashed into 0b7e703 + 67ea1b6)

> Combined release of M0–M3. See README roadmap for milestone definitions.
> M0: Baileys 7.x core, supervisor/worker, SQLite store.
> M1: AGPL relicense, zod config (later lost, restored in 0.4.1).
> M2: Multi-stage Dockerfile, Compose with observability profile, docs.
> M3: Commands triage — fixed 5 quarantined commands, command runner,
>     contract tests, auto-generated docs catalog.

### Added (highlights)
- Multi-store backend (SQLite / Postgres / MongoDB / Redis)
- Pluggable auth backend (MultiFile / Redis / SQLite)
- Pairing-code login (alt to QR)
- Built-in web dashboard at `:3001`
- Temp-file garbage collector
- `recordStat`/`getStats` API on all stores

---

[Unreleased]: https://github.com/Cosm1cBug/EchoFox/compare/v0.4.1-beta...HEAD
[0.4.1-beta]: https://github.com/Cosm1cBug/EchoFox/compare/v0.4.0-beta...v0.4.1-beta
[0.4.0-beta]: https://github.com/Cosm1cBug/EchoFox/releases/tag/v0.4.0-beta
