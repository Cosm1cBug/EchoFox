# Changelog

All notable changes to EchoFox will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

### Planned
- CI/CD with auto-release on tag 
- VitePress docs site at cosm1cbug.github.io/echofox 


---

## [1.1.2] — 2026-06-10

> **Dashboard tabs for v1.1.0 data.** Five new React tabs surface all
> the v1.1.0 extended-event data (blocklist, contacts, presence,
> labels, newsletters) in the dashboard. Plus a quality-of-life fix
> for 3 pre-existing TypeScript strict errors blocking
> `npm run typecheck:dashboard` since v1.0.0.

### Added

- **5 new dashboard tabs**:
  - **Blocklist** (`/api/blocklist`) — table of blocked JIDs with
    block timestamps, auto-refresh every 30 s
  - **Contacts** (`/api/contacts`) — paginated table (50 per page)
    with client-side filter, surfaces v1.1.0 extended `status` +
    `verifiedName` columns
  - **Presence** (`/api/presence`) — top 50 recently-active users with
    state icons (typing/recording/online/offline/paused), state-count
    summary chips, relative timestamps refreshing every 5 s,
    auto-refetch every 10 s
  - **Labels** (`/api/labels`) — WA Business labels with color
    swatches, master/detail view showing chat + message associations
  - **Newsletters** (`/api/newsletters`) — list with subscriber counts
    (formatted as `1.5k`/`1.2M`) and verification badges,
    master/detail view with per-message view counts and per-user
    settings
- **17 new TypeScript API client functions** in `dashboard/src/lib/api.ts`
  covering every v1.1.0 `/api/*` route (blocklist, contacts × 2,
  chats × 2, presence × 3, labels × 3, newsletters × 4, lid-mapping)
- **Dashboard tab navigation reorganized** — new order surfaces
  high-value tabs first: Overview, Groups, Contacts, Presence,
  Newsletters, Subscriptions, Labels, Blocklist, then Metrics,
  Diagnostics, Alerts.

### Fixed

- **3 pre-existing TypeScript strict errors** blocking
  `npx tsc -b --noEmit` since v1.0.0 (Vite tolerated them):
  - `dashboard/src/pages/Alerts.tsx:18` — `getAlerts()` response
    typed as `unknown`; now cast as `any` for the `.active` access
  - `dashboard/src/pages/Groups.tsx:18` — `setGroups` passed
    directly to `.then()` had a `Dispatch<SetStateAction>` type
    mismatch; now wrapped in a typed arrow
  - `dashboard/src/pages/Overview.tsx:77` — `recentActivities`
    literal typed as plain `string[]` instead of the
    `"message" | "command" | "alert"` union expected by
    `ActivityItem`; now explicitly typed

### Backward compatibility

Fully compatible with v1.1.1:

- No backend changes (zero new code in `src/`)
- All v1.1.x API routes unchanged
- No new dependencies (no `package-lock.json` regeneration needed)
- All 101 backend tests still pass
- Dashboard builds in ~4.5 s (same as v1.1.1)

### Operational notes

- Run `npm run build:dashboard` after pulling (or just `npm start` —
  the build-on-boot guard auto-runs `vite build` if `src/dashboard/react/`
  is missing).
- TypeScript strict check now passes — `cd dashboard && npx tsc -b --noEmit`
  is clean. CI gates on TypeScript can now be enabled.

### Stats

- **10 file changes** (5 new tabs + api.ts + App.tsx + 3 TS fixes +
  version bump)
- **5 new tabs** (dashboard now has 11 tabs total, was 6)
- **17 new API client functions**
- **3 pre-existing TS errors eliminated**
- **0 backend changes**
- **101 / 101 backend tests still pass**
- **TypeScript strict: 0 errors** (was 3)

---

## [1.1.1] — 2026-06-10

> **Security + Text-to-Speech overhaul.** Down from 14 → 2 known
> CVEs (the remaining 2 are upstream in `link-preview-js` bundled
> inside `@whiskeysockets/baileys`). Adds a multi-provider TTS
> abstraction with Edge (default), Google, Piper, and Coqui backends.
> Fixes a latent crash in the new call handler.

### Added

- **Multi-provider TTS facade** at `src/services/tts/`:
  - `index.js` — provider-agnostic `synthesize(text, opts) → Buffer`
  - `providers/edge.js` — Microsoft Edge neural voices (default, free, no setup)
  - `providers/google.js` — google-tts-api + axios (basic gTTS)
  - `providers/piper.js` — subprocess to local `piper` binary (offline)
  - `providers/coqui.js` — subprocess to Python `TTS` (offline, best quality)
- **`config.tts.*` config block** — `provider`, `defaultLang`, `defaultVoice`,
  `maxChars`, per-provider sub-blocks. See `config.example.js`.
- **Edge TTS voice defaults for 23 languages** — picks a sensible neural
  voice automatically when only a 2-letter lang code is provided.

### Fixed

- **`node-datachannel` missing from package.json** — was `require()`d
  in `src/lib/callManager.js` (added in commit `9caf3d6` "call feature
  update") but never declared. Bot would crash on first incoming call.
  Now declared as `^0.32.3`.

### Security

Eliminated 12 transitive CVEs in one pass:

- **`node-gtts` removed entirely** — replaced by the new TTS facade.
  Kills 6 CVEs: `form-data`, `request`, `qs`, `tough-cookie`, `uuid`,
  `node-gtts` itself (all came from the abandoned `request` chain).
- **`node-cron` bumped 3.0.3 → 4.2.1** — kills the transitive `uuid` CVE.
  v4's `cron.schedule()` + `cron.validate()` APIs are unchanged for our
  usage in `alienvault-pulse.js` + `backupEngine.js`.
- **`music-metadata` bumped 11.7.x-11.12.1 → 11.13.0** — fixes the ASF
  parser infinite-loop CVE.
- **`fast-xml-parser` bumped 4.5.0 → 5.8.0** — fixes the XMLBuilder
  injection CVE.
- **New overrides** for `sharp` (^0.34.5) and `file-type` (^22.0.1)
  inside `wa-sticker-formatter` — kills 2 more CVEs.
- **New override** for `axios` (^1.7.7) inside the new `google-tts-api`
  dep — preempts its bundled axios 0.21.x from carrying any CVEs.

**Audit before v1.1.1:** 14 vulnerabilities (2 critical, 5 high, 7 moderate)
**Audit after v1.1.1:**   2 vulnerabilities (2 high, both inside
`@whiskeysockets/baileys` → `link-preview-js`; upstream's to fix)

### Changed

- `src/commands/convert/tts.js` — rewritten to use the TTS facade.
  144 lines → 88 lines. Provider-aware error messages
  ("TTS (edge) failed: …" instead of generic).
- `src/workers/mediaWorker.js` — TTS path uses the facade. Lazy
  `require()` inside the worker so msedge-tts/google-tts-api only
  load on first synthesis call.

### Backward compatibility

Fully compatible with v1.1.0:
- `.tts <lang>` command works identically from the user's perspective —
  the underlying engine is just better (neural voice instead of gTTS)
- No config schema breakages — `config.tts.*` is all-optional with
  sensible defaults
- All 101 tests still pass

### Operational notes

- **Run `del package-lock.json && rmdir /s /q node_modules && npm install`**
  after pulling. Required to (a) pick up the new overrides and (b) drop
  the now-extraneous `node-gtts` chain.
- **Default provider is Edge TTS** — works out-of-the-box, no API keys,
  better quality than the old gTTS. Just set `config.tts.provider: 'google'`
  if you want the old-style basic gTTS instead.
- **Piper / Coqui require local setup** — see provider file headers
  for install steps. They're optional offline backends; most users
  should stick with Edge.
- **`.tts <lang>` smoke test:** reply to any text message with `.tts hi`
  → expect a Hindi voice note. The voice is now Aria/Swara/etc. neural
  voices, noticeably more natural than the old gTTS robot voice.

### Stats

- **13 file changes** across 2 sub-groups
- **4 new TTS provider files** (~450 lines new code)
- **12 transitive CVEs eliminated**
- **1 latent crash bug fixed** (node-datachannel)
- **0 new tests** (TTS providers test against real network — covered
  by manual smoke per RC_CHECKLIST)
- **All 112 source files have AGPL headers** (was 106; added 6 TTS files)

---

## [1.1.0] — 2026-06-09

> **Full WhatsApp event automation.** All 16 previously-stub event
> handlers now persist real data into proper backing tables, exposed via
> 16 new `/api/*` routes for the dashboard + AI tool-calling. This
> release is the data foundation for v1.2.0's AI chatbot.

### Added

- **All 16 stub event handlers now persist**:
  - `blocklist.set` / `blocklist.update` — full + incremental
  - `chats.upsert` / `chats.update` / `chats.delete` — extended
    fields (pinned, muted, archived, deleted_at)
  - `contacts.upsert` — extended fields (status, verifiedName)
  - `presence.update` — per-user, per-chat presence + last-seen
  - `labels.edit` / `labels.association` — WA Business labels CRUD
    with soft-delete + chat/message associations
  - `newsletter.upsert` / `newsletters.update` — metadata
  - `newsletter.reaction` / `newsletter.view` — engagement counters
  - `newsletter-settings.update` — per-newsletter user settings (JSON)
  - `lid-mapping.update` — LID ↔ JID bidirectional (Baileys 7.x)
  - `message-capping.update` — per-chat storage limit
- **Migration 004** (`extended_events`) for all 4 backends — creates 9
  new tables + adds 6 columns to existing tables. Idempotent + auto-runs
  on boot.
- **22 new store methods × 4 backends** (88 implementations total) with
  full feature parity across SQLite, Postgres, MongoDB, Redis.
- **16 new `/api/*` routes**:
  - `/api/blocklist` — blocklist
  - `/api/contacts` (paginated) + `/api/contacts/:jid`
  - `/api/chats` + `/api/chats/:jid`
  - `/api/presence` (recent) + `/api/presence/:jid` + `/api/chats/:jid/presence`
  - `/api/labels` + `/api/labels/:id/associations` + `/api/chats/:jid/labels`
  - `/api/newsletters` + `/api/newsletters/:id` + `/api/newsletters/:id/views` + `/api/newsletters/:id/:msgId/reactions`
  - `/api/lid-mapping/:lid`
- **11 new tests** in `stores-v110.test.js` covering all new store
  methods. Total test count: **101 / 101 passing** (was 90).

### Fixed

- **Critical Redis-backend regression from v1.0.1+** — Group A/B added
  `K + ':...'` patterns to `redisStore.js` but the `K` namespace
  constant was never declared. Redis users would get `ReferenceError:
  K is not defined` on every blocklist/presence/contacts write. Now
  declared as `const K = 'echofox'` at the top of `makeRedisStore()`.
- **`newsletter.update` destructure mismatch** (carry-over from
  v1.0.2) — handler destructured `{ updates }` but the worker emits
  `{ sock, u }`. Now correctly handles both array + single-object
  payloads.
- **`scripts/add-license-headers.js` checks React build output** —
  was finding "missing headers" in the bundled minified JS at
  `src/dashboard/react/`. Now correctly excludes that dir.

### Changed

- All 4 store backends now expose the same v1.1.0 method surface —
  drop-in backend swap (SQLite ↔ Postgres ↔ MongoDB ↔ Redis) still
  works for the full v1.1.0 feature set.
- `store.bind(sock.ev)` and the new handlers cooperate: bind handles
  baseline fields (name, unread, ts), new handlers handle extended
  fields (pinned, muted, archived, status, verifiedName). COALESCE
  semantics in the upsert SQL means neither path wipes the other's data.

### Backward compatibility

Fully compatible with v1.0.x:
- No config schema changes
- No existing store interface changes (new methods ADDED, none changed)
- No `/api/*` route signatures changed (only new routes ADDED)
- No command behaviour changes
- Migration 004 is non-destructive and idempotent
- New columns on existing tables use `IF NOT EXISTS` / safe-ALTER

### Operational notes

- Migration runs automatically on boot. To run manually: `npm run migrate`.
- **Redis users especially benefit** — v1.0.1's silent regression
  is now fixed.
- No new dependencies, no `package-lock.json` regeneration required.

### Stats

- 30 file changes across 6 sub-groups
- 22 new store methods × 4 backends = 88 method implementations
- 9 new tables (+ 6 new columns on existing tables)
- 16 new `/api/*` routes
- 11 new tests (101 / 101 total)
- 0 new lint errors, 0 new CVEs

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