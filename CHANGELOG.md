# Changelog

All notable changes to EchoFox will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- CI/CD with auto-release on tag (M4)
- VitePress docs site at cosm1cbug.github.io/echofox (M5)
- 2-week soak test → v1.0.0 (M6)

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
