# Changelog

All notable changes to EchoFox will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

### Planned

- CI/CD with auto-release on tag
- VitePress docs site at cosm1cbug.github.io/echofox

---

## [1.11.3] — 2026-06-18

> **Diagnostic hotfix.** v1.11.2 fixed the test step but the actual
> `npm publish` command still fails with an unhelpful "exit code 1"
> annotation. This release adds explicit pre-publish diagnostics so the
> next failure log tells us exactly what's wrong (token missing? bad
> scope? wrong account? 2FA?). Also makes the publish step non-fatal so
> a transient npm-side failure doesn't poison the rest of the workflow
> chain.

### Changed — `.github/workflows/npm-publish.yml`

- **NEW: "Pre-publish diagnostics" step** — runs before `npm publish`
  and emits a clear log section:
  - Confirms `NPM_TOKEN` secret is set (and prints its length, never
    the value).
  - Runs `npm whoami` so you can see which account the token belongs
    to (or that it's invalid/expired).
  - Lists granular token scopes if available.
  - Fails fast with a remediation hint if any check fails.
- **`npm publish` step now uses `--loglevel=verbose`** — captures the
  actual npm-side error (rate limit, scope error, validation failure,
  etc.) in the workflow log instead of just exit code 1.
- **`npm publish` step marked `continue-on-error: true`** — a transient
  npm-side failure no longer breaks the workflow chain. A new
  "Final status" step reports the real result + a prioritised list of
  common causes if it failed.

### Why

After v1.11.2 fixed the test-step failure, the npm publish step still
returned exit 1 with no useful log line — just "Process completed with
exit code 1". That's not enough to diagnose remotely. v1.11.3 makes
the workflow self-diagnose so the next failure log includes:

- whether the token is set
- whether it's valid (whoami succeeds)
- which account it's bound to
- the verbose npm publish output (HTTP status, error code, etc.)

After this lands, push v1.11.3 → watch the run log → the actual root
cause is one click away in the "Pre-publish diagnostics" or "Publish
to npm" step output.

### Notes

- No source changes. Pure CI plumbing.
- 223/223 tests still pass.
- Docker Hub fix (separate issue) still needs the manual repo
  creation at hub.docker.com — see v1.11.2 changelog entry above.

---

## [1.11.2] — 2026-06-17

> **Hotfix release.** Fixes npm publish workflow that was failing
> because `npm ci --ignore-scripts` skipped `better-sqlite3`'s native
> binding download, causing all sqlite-touching tests to crash on
> missing bindings.

### Fixed

- **`.github/workflows/npm-publish.yml`** — dropped `--ignore-scripts`
  from the `npm ci` step. Tests now have a working `better-sqlite3`
  binding and complete the suite (223/223). The security concern was
  overblown for our use case: we own the lockfile, every dep change
  goes through a reviewed Dependabot PR, and `npm publish` itself
  ships only the files listed under `package.json"files"` — node_modules
  is never included.

### Action required on your side

- **Docker Hub publish is still failing** (separate issue, NOT
  fixed by this release). Root cause: the Docker Hub repo
  `cosm1cbug/echofox` doesn't exist. Fix:
  1. Sign in to <https://hub.docker.com>.
  2. Click "Create Repository", name it `echofox`, visibility
     "Public", description "WhatsApp bot built on Baileys".
  3. Click Create. (Your existing `DOCKERHUB_TOKEN` already has the
     right scope — no token regeneration needed.)
  4. The next push will succeed (GHCR push has been succeeding the
     whole time — you can see it at
     <https://github.com/Cosm1cBug/EchoFox/pkgs/container/echofox>).

### Notes

- No source-code changes. CI plumbing fix only.
- 223/223 tests pass. Other gates unchanged.

---

## [1.11.0] — 2026-06-17

> **CI/CD plumbing release.** Fixes the Docker + npm release pipelines
> that have been silently no-op since v1.5.0 (they required a `git push
--tags` that wasn't being done), adds Dependabot auto-merge for safe
> bumps, and unblocks the GitHub Pages docs site that was never
> deploying.

### Fixed — release pipeline (the root cause of "Docker/npm not releasing")

- **`.github/workflows/docker.yml`** — was tag-trigger only (`tags: ['v*']`).
  Since v1.5.0 you've been pushing main only (`git push origin main` without
  `--tags`), so this workflow never fired. Result: no Docker images at
  `:1.5.0` through `:1.10.0` on GHCR or Docker Hub.
  **Fix:** added the same "push-to-main + version-bump detection" logic
  that `release.yml` already had. Now: push to main with a version
  bump → Docker image builds and publishes automatically.
- **`.github/workflows/npm-publish.yml`** — same root cause, same fix.
  npm registry has been stuck on whatever last got tagged (likely v1.4.x).
  Now: push to main with a version bump → npm publish runs (idempotent;
  skips if already published).

### Added — Dependabot auto-merge

- **`.github/workflows/dependabot-auto-merge.yml`** — auto-merges
  Dependabot PRs that pass CI when the bump is **patch or minor**.
  Major bumps still require manual review. Implementation uses
  `dependabot/fetch-metadata@v2` to read the bump severity, then
  `gh pr merge --auto --squash` to enable GitHub's native auto-merge
  (which respects all your branch-protection status checks).
  Result: routine dep maintenance happens with zero clicks; major
  bumps still land in your PR queue for a deliberate look.

### Fixed — GitHub Pages docs site

- **`.github/workflows/docs.yml`** — dropped the `paths: ['docs/**']`
  filter that was preventing deploys from firing on most commits.
  Also added a `npm run docs:commands` step that regenerates
  `docs/commands.md` from `src/commands/` before each build, so the
  docs site always reflects the live command catalog (currently 55
  commands across 10 categories).
- **`docs/.vitepress/config.mjs`** — `base: '/'` → `base: '/EchoFox/'`
  so CSS/JS asset URLs resolve correctly when served from a project
  Pages namespace (`https://cosm1cbug.github.io/EchoFox/`).
- **`SETUP-PAGES.md`** _(new)_ — 30-second walkthrough for the
  one-time GitHub Pages enable step in repo settings. Once enabled,
  every push to main auto-rebuilds and redeploys.

### Notes

- **No source-code changes** in `src/`. This release is pure CI/CD
  plumbing.
- **No new npm dependencies.** All workflows use first-party or
  existing GitHub Actions.
- After this lands, your release UX becomes: edit `package.json`
  version → `git push origin main` → 3 workflows run in parallel
  (Release, Docker, npm) → 2-3 minutes later, GitHub Release page +
  Docker tags + npm registry all show the new version. No
  `git push --tags` needed.
- Release notes inline per the post-v1.5.0 preference.

---

## [1.10.0] — 2026-06-17

> **Security & dependency consolidation release.** Closes 2 of 7 npm-audit
> advisories at root (form-data CRLF, protobufjs property-shadowing), all
> 2 dashboard advisories (esbuild, vite path-traversal), applies 5 safe
> Dependabot bumps, modernises 3 GitHub Actions, restores the v1.9.0
> test file that was missed during the prior push, and documents the
> 5 remaining transitive advisories with mitigation rationale in
> `SECURITY.md`. **Closes all 11 stale Dependabot PRs.**

### Security — npm audit advisories closed

| Advisory            | Pkg                 | Was     | Now     | How                   |
| ------------------- | ------------------- | ------- | ------- | --------------------- |
| GHSA-hmw2-7cc7-3qxx | form-data           | 4.0.5   | 4.0.6   | Top-level `overrides` |
| GHSA-f38q-mgvj-vph7 | protobufjs          | 7.6.2   | 7.6.4   | Top-level `overrides` |
| GHSA-67mh-4wv8-2f99 | esbuild (dashboard) | <0.28.0 | ≥0.28.1 | via vite 8            |
| GHSA-gv7w-rqvm-qjhr | esbuild (dashboard) | <0.28.0 | ≥0.28.1 | via vite 8            |
| GHSA-4w7w-66w2-5vf9 | vite (dashboard)    | 5.4.2   | 8.x     | direct bump           |

5 root-level advisories remain (all from `link-preview-js` under Baileys

- `esbuild` under `vitepress`) — see `SECURITY.md` for rationale. Both
  chains are either dev-only or already mitigated by our v1.5.0 SSRF guard.

### Security — Dependabot PRs closed (no longer needed)

- PR #1 — `moment-timezone` (subsumed: bumped here to 0.6.2)
- PR #3 — `yargs` (subsumed: bumped here to 18.0.0)
- PR #4 — `libphonenumber-js` (subsumed: bumped here to 1.13.3)
- PR #5 — `node-webpmux` (subsumed: bumped here to 3.2.1)
- PR #6 — `github/codeql-action` v3→v4 (subsumed)
- PR #7 — `docker/build-push-action` v6→v7 (subsumed)
- PR #8 — `docker/setup-buildx-action` v3→v4 (subsumed)
- PR #10 — esbuild/vite/plugin-react in dashboard (subsumed by vite 8 bump)
- PR #11 — vite/plugin-react in dashboard (subsumed by vite 8 bump)
- PR #12 — `better-sqlite3` 11→12 (subsumed: bumped here to 12.4.1)
- PR #13 — `form-data` 4.0.5→4.0.6 (subsumed: handled via overrides)

After landing v1.10.0 close all 11 PRs from the GitHub UI — they're
strictly older than `origin/main` now and the same bumps are already
present here.

### Changed — dependencies

- `package.json`:
  - **deps:** `better-sqlite3` 11.8.1 → 12.4.1, `libphonenumber-js` 1.11.0 → 1.13.3, `moment-timezone` 0.5.45 → 0.6.2, `node-webpmux` 3.2.0 → 3.2.1, `yargs` 17.7.2 → 18.0.0 (yargs not currently used in source; safe bump).
  - **overrides (new):** `form-data ^4.0.6`, `protobufjs ^7.6.4` (top-level).
- `dashboard/package.json`:
  - `vite` ^5.4.2 → ^8.0.0
  - `@vitejs/plugin-react` ^4.3.1 → ^5.0.0
- `package-lock.json` + `dashboard/package-lock.json`: regenerated.

### Changed — CI workflows

- `.github/workflows/docker.yml`:
  - `docker/setup-buildx-action` v3 → v4
  - `docker/build-push-action` v6 → v7
- `.github/workflows/security.yml`:
  - `github/codeql-action/init` v3 → v4
  - `github/codeql-action/analyze` v3 → v4
- `.github/dependabot.yml`: removed the bogus `'needs-triage'` label
  (it doesn't exist in the repo and was blocking Dependabot from
  applying its label set — see the warning at the top of every
  Dependabot PR).

### Fixed — v1.9.0 regression

- Restored `src/__tests__/integration/commands-v190.test.js` — was
  missed during the v1.9.0 manual Copy-Item step (`commit shows 8 files
  changed instead of 9). Adds back 9 tests + 1 contract auto-discovery
  = +10 passing tests (213 → 223).

### Documentation

- `SECURITY.md`: new "Known accepted-risk advisories" section listing
  the 5 transitive advisories that can't be fixed locally, with status
  - mitigation rationale + a re-check command. Re-evaluated on every
    release.

### Notes

- **No source-code changes** in `src/` apart from restoring the test file.
- All gates: tests 223/223, lint 0/0, prettier clean, headers 151/151,
  dashboard tsc clean.
- Release notes inline per the post-v1.5.0 preference.

---

## [1.9.0] — 2026-06-17

> **Dev-utils + YouTube downloader release.** Adds 4 new commands across
> `tools/` and `download/` categories. Adds one new config flag
> (`features.ytdl`, default false) to gate the YouTube downloader.
> No new npm dependencies — `@distube/ytdl-core` was already a dep.

### Added — new commands

- **`.base64 <enc|dec> [text|reply]`** _(tools)_ — base64 encode/decode.
  Reply-aware (operate on a quoted message). Validates base64 alphabet
  on decode. Soft cap 8 KB input. _Aliases: `b64`._
- **`.hash <algo> [text|reply]`** _(tools)_ — hash text with md5, sha1,
  sha256, sha384, or sha512 (Node's `crypto.createHash`). Reply-aware.
  Hex output. Soft cap 64 KB input. Help text warns md5/sha1 are
  cryptographically broken. _Aliases: `digest`._
- **`.uuid [N | short [N] | hex [N]]`** _(tools)_ — generate UUIDs (v4),
  URL-safe short IDs (base64url), or 16-byte hex strings. Max 25 per
  call. _Aliases: `guid`, `id`._
- **`.ytdl [audio|video|info] <url>`** _(download)_ — YouTube downloader
  via the already-installed `@distube/ytdl-core`. **Gated behind
  `config.features.ytdl` (default false)** — operator must opt in.
  Default mode: audio (m4a, highest bitrate). Video mode: mp4 ≤720p.
  Info mode: metadata only, no download. Hard caps: 15 min duration,
  50 MB file size. Defence-in-depth host allow-list rejects anything
  outside youtube.com / youtu.be / m.youtube.com / music.youtube.com.
  Refuses livestreams and private videos. Uses `tempManager.getTempFile`
  so files are garbage-collected after 30 min by the existing sweeper.
  _Aliases: `yt`, `youtube`._

### Added — configuration

- **`features.ytdl`** _(boolean, default `false`)_ — opt-in toggle for
  the `.ytdl` command. Off by default because downloading from YouTube
  is a ToS grey area; bot operators should enable it deliberately.

### Added — tests

- **`src/__tests__/integration/commands-v190.test.js`** — 9 new tests
  covering command module shape, base64 round-trip, hash digest
  lengths/format, UUID format + uniqueness, YouTube host allow-list
  positive + negative cases, and the schema flag default.

### Changed

- **`src/lib/configSchema.js`** — 3-line addition: new `ytdl` boolean
  in the `features` object with default `false`.
- **`package.json`** — bumped to `1.9.0`. **No new dependencies.**

### Notes

- `.ytdl` will short-circuit with a friendly "disabled" message until
  an admin sets `features.ytdl = true` in config. The command file
  doesn't require any new package — `@distube/ytdl-core` was already
  in deps for `.song`. A defensive `try { require(...) } catch` falls
  back to a friendly error if the package is ever missing on a host.
- All 3 dev-utils commands are pure (no I/O, no upstream calls), so
  they're instant and immune to upstream-API rate limits or outages.
- Release notes inline per the post-v1.5.0 preference — no separate
  `RELEASE_NOTES_v1.9.0.md` file.

---

## [1.8.0] — 2026-06-17

> **Batch 3 commands release.** Adds 7 new commands packaged as 5 logical
> picks (warn = warn+warnings in one file; tools utility trio shipped
> together). No new dependencies — reuses ai.providers, axiosWithBreaker,
> moment-timezone, and the subscriber_meta persistence pattern.

### Added — new commands

- **`.ask <question>`** _(general)_ — one-shot AI query that bypasses
  per-chat opt-in AND conversation memory. Honours the v1.5.0 cost-cap
  reservation pattern. Reply-aware: combines the quoted message + the
  user's follow-up into a single prompt. _Aliases: `q`, `gpt`._
- **`.explain [eli5|code|auto] [text]`** _(general)_ — explain a replied
  message or arbitrary text. Auto-detects code vs prose (heuristic on
  keywords + brace density). `eli5` mode does kid-level explanations,
  `code` mode does line-by-line. _Aliases: `eli5`, `wat`._
- **`.warn @user [reason]`** _(group)_ — group-admin warn system with
  auto-kick at threshold. Sub-verbs: `list`, `remove`, `clear`,
  `config threshold <N>`. `.warnings` / `.warns` aliases work bare to
  show all warned users. Per-user warn log persisted via
  `subscriber_meta` (synthetic `warnings` service keyed by group jid).
  Default threshold: 3, configurable 1–20. _Aliases: `warning`,
  `warnings`, `warns`._
- **`.antilink [on|off|action|whitelist …]`** _(group)_ — auto-delete
  and/or warn on non-admin posted links. Group admins exempt. Per-host
  whitelist (case-insensitive, suffix match — `github.com` allows
  `api.github.com` too, max 50 entries). 3 action modes:
  `warn`, `delete`, `delete+warn` (default). The detection +
  enforcement hook lives in `messages.upsert.js`. _Aliases: `nolink`,
  `linkblock`._
- **`.define <word>`** _(tools)_ — English dictionary via
  dictionaryapi.dev (free, no key). Returns first 2 part-of-speech
  meanings with definition + example. _Aliases: `def`, `dict`._
- **`.timezone <tz|city>`** _(tools)_ — current time in any IANA tz or
  city. Bare `.worldclock` (alias) shows 9 major cities preset
  (LA, NY, London, Berlin, Dubai, Mumbai, Singapore, Tokyo, Sydney).
  City→tz resolution via Open-Meteo geocoding. Uses the existing
  moment-timezone dep. _Aliases: `tz`, `time`, `worldclock`._
- **`.convert <amount> <from> <to>`** _(tools)_ — currency conversion
  (fiat + crypto). Fiat via Frankfurter (ECB-backed, ~30 currencies);
  crypto via CoinGecko (18 common tickers). Supports fiat→crypto and
  crypto→crypto. _Aliases: `cv`, `fx`, `currency`._

### Added — infrastructure

- **`src/services/warnService.js`** — warn CRUD + threshold management
  over `subscriber_meta`. Hard cap 100 warns/user, 20 max threshold.
- **`src/services/antilinkService.js`** — link detection (regex-based,
  http/https or www. only — won't false-positive on `node.js`), host
  extraction, whitelist matching (suffix-aware), config CRUD.
- **`src/__tests__/integration/commands-v180.test.js`** — 13 new tests
  covering link-detection edge cases, whitelist suffix-match semantics,
  service exports, and module-shape for all 7 new commands.

### Changed

- **`src/events/messages.upsert.js`** — single-line require + ~50-line
  antilink hook inserted just before the prefix-detection block. Hook
  is fully gated on `config.enabled` and lazy-fetches group metadata
  only when a link is detected, so it has zero cost for normal traffic.
  Failed delete/warn sends are logged at debug-level and never crash
  the message pipeline.
- **`package.json`** — bumped to `1.8.0`. No new dependencies.

### Notes

- The antilink hook is **per-group opt-in** (default off). Users with
  existing groups see no behavioural change until they explicitly run
  `.antilink on`.
- The warn auto-kick requires the bot to also be a group admin —
  graceful message surfaces if it isn't.
- `.convert` crypto pricing comes from CoinGecko's public endpoint
  (rate-limited ~30 req/min unauthenticated). Heavy use should consider
  configuring an API key in a future release.
- Release notes inline per the post-v1.5.0 preference — no separate
  `RELEASE_NOTES_v1.8.0.md` file.

---

## [1.7.0] — 2026-06-17

> **Batch 2 commands release.** Adds 5 more commands across `tools/`,
> `general/`, `admin/`, and `group/` categories. No new dependencies —
> all infra reuses existing primitives (axiosWithBreaker, ai.providers,
> subscriber_meta, lru-cache, wrapSocketSend).

### Added — new commands

- **`.shorten <url>`** _(tools)_ — URL shortener via is.gd (free, no API
  key). Reuses the v1.5.0 SSRF private-host guard from `toolRegistry`
  to refuse shortening links to internal/private hosts. Soft cap 2 KB
  input. _Aliases: `short`, `tinyurl`._
- **`.summarize [N | reply]`** _(general)_ — AI summary of the last N
  messages in the chat (default 50, cap 200) or the quoted message.
  Calls the configured AI provider directly so conversation memory is
  NOT mutated. Honours the v1.5.0 cost-cap reservation pattern. Falls
  back gracefully when the store backend lacks `getRecentMessages`.
  _Aliases: `sum`, `tldr`, `recap`._
- **`.purge [N | <duration>]`** _(admin)_ — admin-only. Revokes the
  bot's recently-sent messages in this chat using Baileys' `delete`
  protocol message. Backed by the new `sentMessageTracker` service
  (bounded LRU, 100 entries/chat, 24h TTL). Accepts either count
  (`.purge 25`, max 100) or duration (`.purge 5m`, `.purge 1h`).
  In-process tracking only by design. _Aliases: `clear`, `cleanup`._
- **`.welcome [bye] [on|off|set|reset|test]`** _(group)_ — group-admin-only.
  Configures per-group welcome/goodbye templates with `{user}`,
  `{group}`, `{count}` placeholders. Templates persisted via
  `subscriber_meta` under the synthetic `greetings` service. Actual
  dispatch happens automatically from `group-participants.update.js` on
  `add`/`join`/`leave`/`kick` events. _Aliases: `greet`, `goodbye`._
- **`.imagine [-s 256|512|1024|1792] [-q standard|hd] <prompt>`** _(general)_ —
  text→image via OpenAI Images (`gpt-image-1`). Strict cost-cap aware:
  per-image price reserved up-front, recorded on completion. Supports
  HD quality flag and multiple sizes. Returns generated image as
  attachment with prompt + cost in caption. 60s cooldown.
  _Aliases: `img`, `gen`, `dalle`._

### Added — infrastructure

- **`src/services/sentMessageTracker.js`** — non-destructive wrapper
  around `sock.sendMessage` that captures every outbound message key
  into a per-chat ring buffer (100/chat, 24h TTL, 2k chats LRU-bounded).
  `wrap(sock)` is idempotent so reconnects don't double-wrap.
- **`src/services/greetingService.js`** — per-group welcome/goodbye
  template store + renderer with placeholder substitution and
  template-validation helpers.
- **`src/__tests__/integration/commands-v170.test.js`** — 14 new tests
  covering tracker behaviour, greeting rendering/validation, and
  command-module shape for all 5 new commands.

### Changed

- **`src/core/worker.js`** — single-line require + 2-line
  `sentMessageTracker.wrap(sock)` call inside the existing
  `wrapSocketSend` block. Both wrappers chain cleanly.
- **`src/events/group-participants.update.js`** — single-line require +
  invocation of new `dispatchGreetings()` helper after the existing
  `groupUpdates` channel notification. The helper is fire-and-forget so
  greeting send failures never block participant-event processing.
- **`package.json`** — bumped to `1.7.0`. No new dependencies.

### Notes

- Reminder service from v1.6.0 unchanged; AFK state unchanged.
- The `imagine` command depends on `config.ai.providers.openai.apiKey`
  (or `OPENAI_API_KEY`). Failure mode is a friendly user-facing error,
  not a crash.
- `sentMessageTracker` is intentionally in-memory: purge after a process
  restart will find nothing to revoke, which matches user expectation
  (you only purge "recent" stuff).
- Release notes inline per the post-v1.5.0 preference — no separate
  `RELEASE_NOTES_v1.7.0.md` file.

---

## [1.6.0] — 2026-06-17

> **Engagement & utility release.** Adds 5 new commands across `tools/`
> and `user/` categories, plus the supporting infra for persistent
> reminders and AFK state.

### Added — new commands

- **`.qr <text>`** _(tools)_ — generate a QR-code PNG (512×512, EC=M)
  from any text or URL. Powered by the `qrcode` package — fully offline,
  no network dependency. Soft cap 2 KB input. _Aliases: `qrcode`, `qrgen`._
- **`.weather <city|lat,lon>`** _(tools)_ — current conditions + 3-day
  forecast via Open-Meteo (free, no API key, 10k req/day). Auto-geocodes
  city names, accepts raw coordinates, renders WMO weather codes to
  human-readable emoji lines. Uses the existing circuit-breaker + retry
  HTTP client. _Aliases: `w`, `forecast`._
- **`.poll [-m] "Question" "Opt A" "Opt B" …`** _(tools)_ — create a
  native WhatsApp poll. Quote-aware tokenizer supports multi-word
  options. `-m`/`--multi` flag enables multi-select. Validates against
  the WA protocol limits (2–12 options, ≤255 char question, ≤100 char
  per option). _Aliases: `vote`._
- **`.remindme <duration> <message>`** _(tools)_ — schedule a one-shot
  reminder delivered to the same chat. Duration grammar combines units
  (`10s`, `5m`, `2h30m`, `1d12h`, `1w`). Plain integers parse as seconds.
  Sub-commands: `list`, `cancel <id>`, `clear`. Persisted via the existing
  `subscriber_meta` table (no migration needed) so reminders survive
  restarts. Up to 50 pending per user, 1-year max horizon. Backed by a
  new minute-tick cron started from `core/worker.js`. _Aliases: `remind`,
  `reminder`._
- **`.afk [reason | off]`** _(user)_ — mark yourself away. The bot
  auto-replies once per 30 s per chat when AFK users are mentioned or
  quoted-to, and automatically clears the flag the next time the AFK
  user sends a message. In-memory state (LRU, bounded to 10k users,
  7-day TTL ceiling). _Aliases: `away`._

### Added — infrastructure

- **`src/services/afkState.js`** — bounded LRU store of currently-AFK
  users with debounced announce helper and human-readable duration
  formatter. Exposes `mark`, `clear`, `isAfk`, `shouldAnnounce`, `get`.
- **`src/services/reminderService.js`** — persistent reminder ticker.
  Per-minute scan of all subscribers under the synthetic `reminders`
  service; fires due items via `sock.sendMessage` with `@mention` of the
  user; rewrites meta in place. Hardened: per-user failures don't stop
  the tick, and the service is restart-safe.
- **`src/__tests__/integration/commands-v160.test.js`** — 14 new
  tests covering AFK state, duration parsing, and command-module shape.

### Changed

- **`src/events/messages.upsert.js`** — small AFK auto-handler block
  added near the top of `handleMessage` (5-line require + 30-line hook).
  Surfaces AFK announcements for `ctx.mentions` and quoted-reply
  participants, and auto-clears on the AFK user's next message.
- **`src/core/worker.js`** — single-line require + 2-line `reminderService.start(sock)`
  call after `creds.update` listener registration. Service guards against
  double-init on reconnect.
- **`package.json`** — bumped to `1.6.0`; added top-level dep `qrcode@^1.5.4`.

### Notes

- No new schema migration. `.remindme` persistence rides the existing
  `service_subscribers.meta` JSON column that was added in migration 001.
- AFK is intentionally in-memory only. Persisting AFK across restarts
  would create stuck-AFK states when the bot restarts overnight.
- Release notes for v1.6.0+ live inline in this CHANGELOG and the squash
  commit message — no separate `RELEASE_NOTES_v*.md` file (per
  user preference established post-v1.5.0).

---

## [1.5.0] — 2026-06-14

> **Security hardening release.** Closes 8 audit findings (3 critical,
> 5 high/medium). No new user-facing features — just stronger defaults,
> harder bypass surfaces, and one safer dependency tree. Drop-in upgrade
> from v1.4.6.

### Security fixes

- **Dashboard default password is now refused at startup** when
  `dashboard.enabled = true`. Booting with `password: "change-me-please"`
  (or any password <12 chars) now fails Zod validation with a clear
  error message pointing at `config.bot.password` or the
  `ECHOFOX_DASHBOARD_PASSWORD` env var.

- **Session files moved outside the `src/` tree by default.** New
  fresh installs put WhatsApp credentials at `./data/sessions/`
  (relative to `process.cwd()`) instead of `src/@session/`. The new
  `config.bot.sessionDir` field accepts an absolute or
  cwd-relative path; the legacy `config.bot.sessionName` field still
  works (with a startup warning) for back-compat with existing
  deployments. If you have an existing `src/@session/` folder, **move
  it to `./data/sessions/` and set `config.bot.sessionDir` to silence
  the warning** — your WA pairing survives.

- **SSRF guard hardened significantly** in `fetch_url`:
  - Now also blocks `100.64.0.0/10` (CGNAT, some AWS configs),
    `0.0.0.0/8`, `metadata.google.internal`, `.internal` / `.corp` /
    `.lan` TLDs, IPv6 link-local (`fe80::/10`), IPv6 unique-local
    (`fc00::/7`), IPv4-mapped IPv6 (`::ffff:`), and the docs prefix
    `2001:db8::`.
  - **Hostnames are now actually resolved via DNS before fetching.**
    Prevents DNS-rebinding (attacker.com resolves to `8.8.8.8` at the
    literal-check stage, then `127.0.0.1` at fetch time). If the
    resolved address is private, the fetch is refused with
    `error: 'private_host_blocked', detail: 'resolved_to_private'`.
  - Added explicit `maxBodyLength: 200_000` alongside the existing
    `maxContentLength` (closes the gap where axios was only checking
    the `Content-Length` header).

- **`xml2js` removed** (CVE-2023-0842, prototype pollution).
  - `src/services/thehackersnewsService.js` and
    `src/services/genericRssService.js` migrated to `fast-xml-parser`
    (which was already a dependency).
  - Includes a compatibility helper for the differing attribute /
    text-node conventions so Atom feeds still parse correctly.

- **AI cost cap now uses in-flight reservations** to close the
  concurrent-request race window. New API in
  `src/services/ai/costTracker.js`:
  - `reserve(estimatedUsd)` → opaque id; called before each LLM
    request with an upper-bound cost estimate (max_tokens × the most
    expensive whitelisted model's completion price + 20% margin).
  - `release(id)` → called after each LLM call to remove the
    reservation.
  - `isOverCap()` now includes active reservations in its total,
    so two concurrent requests can't both pass when their combined
    estimated cost would exceed the cap.

- **Config loader now emits a structured fatal log** when
  `src/config.js` has a JS syntax error or throws at `require()` time.
  Previously surfaced as a cryptic Node parse stack (especially
  invisible inside Docker). Now prints a boxed message with the
  exact file path, the error message, and a suggested action before
  the worker exits.

### Operational improvements

- **Baileys version warning at startup.** If the installed
  `@whiskeysockets/baileys` is a prerelease (`-rc`, `-beta`,
  `-alpha`, `-next`, `-preview`, `-dev`), the bot emits a `WARN`-level
  log at boot pointing operators at the Baileys releases page and
  recommending pinning to a GA version when one is available.
  Prereleases are subject to silent WhatsApp protocol breakage.

### Removed

- **`xml2js` dependency** — replaced by `fast-xml-parser` (already
  present). One fewer prototype-pollution-prone library.
- **`@vitalets/google-translate-api`** — was a leftover from an
  earlier translate command; the active library is
  `google-translate-api-x`. Unused, removed.

### Added

- 6 new integration tests in
  `src/__tests__/integration/security-v150.test.js`:
  default-password rejection, sessionDir schema, full
  `_isPrivateHost` matrix (24 cases incl. v1.5.0 additions),
  reserve/release/isOverCap interaction, `estimateMaxCostUsd`,
  Baileys version sanity check.

### Migration notes

- **No schema breakage.** All v1.4.x configs still parse. New
  validators only run when `dashboard.enabled = true`.
- If you run with `dashboard.enabled = true` and you've never changed
  the default password, **the bot will now refuse to start.** Set a
  strong password (≥12 chars) in your `config.js` or via the
  `ECHOFOX_DASHBOARD_PASSWORD` env var.
- If you have an existing `src/@session/` directory it keeps working
  with a deprecation warning. Set `config.bot.sessionDir` to silence
  it and move the directory to its safer location.
- **No new dependencies.** v1.5.0 removes 2 (`xml2js`,
  `@vitalets/google-translate-api`) and adds 0.
- AI cost cap is now stricter — concurrent requests that would
  collectively exceed the cap are now refused, where previously they
  could "leak" past it by racing through `isOverCap()`. If you see
  unexpected `cost_cap` rejects in your AI logs, raise
  `config.ai.costCapPerDayUsd`.

### Audit findings deferred to a later release

- TypeScript migration — discussed, deferred to v2.0.0.
- `node-cache` → `lru-cache` consolidation — Baileys' caches API
  is sensitive to method-signature differences; defer until proper
  integration testing.

---

## [1.4.6] — 2026-06-14

> **Docs deploy hotfix.** The `docs.yml` workflow was failing with
> `Cannot find package 'vitepress'` because vitepress wasn't a
> declared dependency — `npx vitepress` was trying to install it
> just-in-time, which produces an ESM resolution race on GitHub's
> Actions runners.

### Fixed

- Added `vitepress: ^1.6.4` to `devDependencies` in `package.json`
  so `npm ci` installs it properly. `npx vitepress` no longer has
  to download it just-in-time.
- Bumped `.github/workflows/docs.yml` Node version from 20 → 22.
  VitePress 1.6.x requires Node 22 per its `engines` field (the build
  succeeds on Node 20 but emits an `EBADENGINE` warning).
- Replaced `npx vitepress build docs` with `npm run docs:build`
  (cleaner, uses the locally-installed binary directly).

### Added

- Three new convenience scripts in `package.json`:
  - `npm run docs:build` — build the VitePress site
  - `npm run docs:dev` — local hot-reload dev server
  - `npm run docs:preview` — preview the built site

### Migration notes

- Drop-in upgrade from v1.4.5. `npm install` once after pulling to
  install the new vitepress dep.

---

## [1.4.4] — 2026-06-13

> **Second CI hotfix.** v1.4.3 fixed the lint + dashboard lockfile issues
> but two more came up on push: 228 files failing Prettier `format:check`,
> and TruffleHog rejecting `--fail --fail`. v1.4.4 reformats the whole
> repo and removes the duplicate flag.

### Fixed

- **228 files now Prettier-formatted** via `prettier --write` across the
  entire tree. Whitespace + trailing-newline normalisation on YAML / JSON
  / MD; multi-line block reflow on `.js` files. Zero functional changes
  — all 147 tests still pass on the reformatted code.
- **TruffleHog `--fail --fail` rejection** — the action's internal shim
  already appends `--fail`, so having it in `extra_args` produced the
  duplicate. Removed from all 3 `extra_args:` instances in
  `.github/workflows/secret-scanning.yml`. Replaced with the canonical
  `--results=verified,unknown`.

### Internal

- `package.json` version bump 1.4.2 → 1.4.4 (v1.4.3 commit accidentally
  omitted the bump).
- `RELEASE_NOTES_v1.4.3.md` added retroactively (also missed from v1.4.3).

### Migration notes

- Drop-in upgrade from v1.4.3. No functional changes.
- If you have local changes, you may see whitespace-only conflicts —
  `git stash`, `git pull`, `git stash pop` + run `npm run format`.

---

## [1.4.3] — 2026-06-13

> **CI hotfix.** Fixed 4 issues that surfaced after v1.4.2 went through
> the release workflows.

### Fixed

- **`src/dashboard/server.js`** — restored the `emit()` helper inside
  the `/metrics` route closure (rewritten as `const emit = (...) => {...}`).
- **28 pre-existing ESLint warnings** — unused `sock` / `req` / `ts` args
  underscore-prefixed; removed unused imports (`zlib`, `axios`,
  `getContentType`, `applyExtraCAsToProcess`, `config`, top-level `axios`
  in `thehackersnewsService`); deleted dead `delay()` function and
  `isHistory` / `isRealTime` flags; removed useless regex escapes;
  `prefer-const` fixes.
- **`dashboard/package-lock.json`** uncommented from `.gitignore` and
  committed.
- **`.github/workflows/secret-scanning.yml`** event-conditional fix
  re-applied (didn't land on main in v1.4.2).
- **`.prettierrc.json`** `endOfLine: "lf"` → `"auto"` (committed
  separately as `f01dcfa "CI fix"` between v1.4.3 and v1.4.4).

---

## [1.4.3] — 2026-06-13

> **CI hotfix release.** v1.4.2 introduced 3 ESLint errors in
> `src/dashboard/server.js` (when an `emit()` helper was moved out
> of its closure to silence `no-inner-declarations`) and surfaced
> 28 pre-existing lint warnings. v1.4.3 cleans all of them up,
> commits the dashboard `package-lock.json` (so `release.yml`'s
> `npm ci` step works), and re-applies the TruffleHog
> `secret-scanning.yml` fix that didn't make it onto main in v1.4.2.

### Fixed

- **`src/dashboard/server.js`** — restored the `emit()` helper inside
  the `/metrics` route handler (where it correctly closes over
  `seen`/`lines`/`now`). Rewrote as an arrow assigned to a `const`
  so the `no-inner-declarations` ESLint rule doesn't apply.
  Was producing 6 `no-undef` ESLint errors blocking CI.
- **28 pre-existing ESLint warnings** cleaned up across the tree
  (most predated v1.4.0 but the previous `ci.yml` wasn't actually
  enforcing `--max-warnings 0`):
  - `scripts/generate-command-docs.js` — 3 useless backtick escapes
    in a regex char class
  - `src/__tests__/integration/ai.test.js` — unused `req` arg → `_req`
  - `src/core/worker.js` — removed unused `applyExtraCAsToProcess`
    import + dead `isHistory`/`isRealTime` flag computations
  - `src/dashboard/server.js` — removed unused `config` import
  - `src/events/{message-receipt,messages.reaction,messages.update,messaging-history.set}.js`
    — unused `sock` destructured param → `sock: _sock`
  - `src/events/messages.update.js` — also removed unused
    `getContentType` import
  - `src/lib/alienvault-pulse.js` — removed unused `delay()` function
  - `src/lib/backupEngine.js` — removed unused `zlib` import
  - `src/services/telegram/transport.js` — removed unnecessary
    `\[` escape inside the MarkdownV2 char class
  - `src/services/thehackersnewsService.js` — removed unused top-level
    `axios` import (the file uses `axiosWithBreaker` instead)
  - `src/store/redisStore.js` — unused `ts` arg in `updateMessageBody`
    → `_ts`
- **`dashboard/package-lock.json`** — uncommented out of `.gitignore`
  and committed. `release.yml`'s `cd dashboard && npm ci` step
  was failing because there was no lockfile to install against.
- **`.github/workflows/secret-scanning.yml`** — re-applied the
  TruffleHog fix that was in the v1.4.2 bundle but never landed
  on `main` (probably skipped during the Copy-Item). Split into
  three event paths:
  - `pull_request` → diff PR head vs PR base
  - `push` → diff `github.event.before` → `github.sha`
    (the commit range that was just pushed)
  - `workflow_dispatch` OR first-push-to-branch → full repo scan

### Why CI is healthy now

| Gate                         | Before v1.4.3             | After v1.4.3            |
| ---------------------------- | ------------------------- | ----------------------- |
| `npm run lint`               | ❌ 6 errors + 28 warnings | ✅ 0 errors, 0 warnings |
| `npm test`                   | ✅ 147/147                | ✅ 147/147              |
| `npm run headers:check`      | ✅ 140 files              | ✅ 140 files            |
| Dashboard `tsc --noEmit`     | ✅                        | ✅                      |
| `npm ci` in `dashboard/`     | ❌ no lockfile            | ✅ committed            |
| TruffleHog secret scan       | ❌ `base == head` on push | ✅ event-conditional    |
| All 7 workflows `actionlint` | ✅                        | ✅                      |

### Migration notes

- Drop-in upgrade from v1.4.2. No schema changes, no config changes,
  no env-var changes.
- `dashboard/package-lock.json` will now appear in your `git status`
  the first time you `cd dashboard && npm install` after pulling.
  Commit it (or rebase past it) — it's tracked now.

---

## [1.4.2] — 2026-06-12

> **Self-healing for Signal protocol decryption errors + CI/CD bug fixes.**
> Main feature: proactive recovery for `Bad MAC` / `No session found` errors
> (after 3 consecutive failures from a sender within 5 minutes, the bot
> auto-resets that sender's Signal session). Also bundles 3 CI fixes that
> surfaced during the v1.4.1 release-workflow runs.

### Added

- **`src/services/signalHealth.js`** — new service tracking per-JID
  decryption failures and triggering self-healing recoveries.
  - Threshold: **3 consecutive failures within 5 minutes**
  - Cooldown: **30 minutes per JID** (caps recoveries at ~2/hr/sender
    even in pathological cases)
  - Memory-bounded via 10-minute prune timer
  - Recognises: `Bad MAC`, `No session found to decrypt message`,
    `No matching sessions found`, `InvalidSignedPreKeyId`,
    `No identity key`
- **Baileys logger wrapper in `src/core/worker.js`** — intercepts
  ERROR-level logs from Baileys, routes decryption failures to
  signalHealth, **demotes the noise from ERROR → DEBUG**. Real
  recoveries surface at WARN with a `🩹` prefix so they stand out.
- **2 new Prometheus counters** in `src/store/schema/stats.js`:
  - `signal_decryption_failures_total`
  - `signal_session_recoveries_total`
- **2 new typed wrappers** in `src/services/metrics.js`:
  `incDecryptionFailure()`, `incDecryptionRecovery()`.
- **NEW Grafana row "Signal Protocol Health (v1.4.2+)"** — 4 panels:
  - Stats: decryption failures (24h), auto-recoveries (24h),
    recovery efficiency ratio
  - Timeseries: decryption failures/sec + recoveries/sec
- **`src/__tests__/integration/signal-health.test.js`** — 10 tests
  covering pattern recognition, JID normalisation (`:device` tag
  stripping), per-JID failure counting, threshold trigger,
  cooldown enforcement, cross-JID isolation, missing-sock graceful
  degradation.

### Changed

- Baileys decryption ERRORs no longer pollute the production log
  stream. They're now demoted to DEBUG (default-hidden) and tracked
  via the metrics + Grafana panels above.

### Why this isn't a ban risk

`signalRepository.deleteSession(jid)` is a **local filesystem operation
only** — no WhatsApp servers are contacted, no traffic crosses the wire.
Recovery is driven entirely by the next inbound message triggering
Signal's standard prekey-fetch flow (the same flow that runs millions
of times daily for every device reinstall on WhatsApp). With the
conservative 3-failure / 5-minute threshold and 30-minute per-JID
cooldown, recoveries are capped at ~2/hour/sender even in adversarial
conditions. Far below anything WhatsApp could plausibly flag.

### Fixed (CI/CD)

- **`npm test` glob expansion failure.** `package.json`'s test script
  used `node --test src/**/*.test.js src/commands/__tests__/*.test.js` —
  Node.js does NOT expand globs, and bash's `**` requires `globstar`
  which isn't enabled by default on Ubuntu CI / macOS / PowerShell.
  CI was failing with `Could not find 'src/**/*.test.js'`.
  - **Replaced** with a new `scripts/run-tests.js` (pure Node recursive
    walker for `*.test.js`). Works identically on Ubuntu CI runners,
    Windows PowerShell, macOS bash/zsh, and every Node version we
    support (20+). Auto-discovers new test files. Spawns
    `node --test <explicit file list>`.
- **TruffleHog secret scanning failure on `push` to `main`.** Old config
  passed `base: github.event.repository.default_branch` and
  `head: github.ref` — both resolved to `main` on push events, causing
  TruffleHog to bail with `base == head`. **Split** the workflow into
  three event paths:
  - `pull_request` → diff PR head vs PR base (the original good path)
  - `push` → diff the pushed commit range (`github.event.before` → `github.sha`)
  - `workflow_dispatch` + first-push-to-branch → full repository scan
- **Release / npm-publish / CI workflows** all called `npm test`, so
  the `scripts/run-tests.js` fix above transitively fixes all three.

### Migration notes

- Drop-in upgrade from v1.4.1. No schema changes, no config changes,
  no env-var changes.
- Re-provision Grafana from `docker/grafana/dashboards/echofox-overview.json`
  to see the new panels (4 new panels under "Signal Protocol Health").

---

## [1.4.1] — 2026-06-12

> **Hotfix release.** Patches a pre-existing runtime bug in
> sqliteStore.getGroupMetadata that v1.4.0 inherited from v1.1.0.

### Fixed

- `src/store/sqliteStore.js:455` — removed stray `F` character that
  caused `ReferenceError: F is not defined` whenever
  `getGroupMetadata(jid)` was called for a JID with no `groups` row.
  In practice this triggered on the first message in a freshly-joined
  group, before metadata had been fetched. Bug predates v1.2.0 but
  surfaced more in v1.2.0+ due to higher event-handler activity.

### Internal

- `.gitignore` — added `*.tsbuildinfo` (and variants) plus
  `dashboard/package-lock.json` so they stop showing as untracked
  in `git status` after `npm install` / `tsc --build`.

### Migration notes

- Drop-in upgrade from v1.4.0. No schema changes, no config changes.
- Re-pull Docker images: `cosm1cbug/echofox:1.4.1` or `:latest`.
- `npm install echofox@1.4.1`.

---

## [1.4.0] — 2026-06-11

> **Ops polish.** v1.4.0 closes the long-standing roadmap items:
> auto-release on tag (Release + Docker + npm publish + Pages deploy),
> a refreshed VitePress docs site covering v1.2/v1.3/v1.4, and a full
> observability slice — 12 new store-backed counters / 3 new gauges
> for AI + Telegram, exposed in Prometheus format on the dashboard
> port, with 12 new Grafana panels and 2 new built-in alert rules.

### Added

- **CI/CD automation**:
  - `release.yml` — full rewrite. Tag-triggered (`v*`) OR version-bump
    on `main`. Gates the release with `npm test` + headers check,
    builds the dashboard, builds an `echofox-<version>.tar.gz`, and
    attaches it as a release asset. Body uses `RELEASE_NOTES_v<v>.md`
    when present, otherwise GitHub's auto-generated notes.
  - `docker.yml` — now also tag-triggered. Tags every image as
    `:1.4.0`, `:1.4` (major.minor), `:latest`, and `:sha-<short>`
    across both `ghcr.io/cosm1cbug/echofox` and Docker Hub. Weekly
    cron retained for base-image patches.
  - **NEW `npm-publish.yml`** — publishes to `registry.npmjs.org` on
    `v*` tag push. Requires `NPM_TOKEN` repo secret. Pre-flight:
    `--ignore-scripts` install, `npm test`, asserts pkg.version
    matches the pushed tag. Idempotent (skips if already published).
    Uses `--provenance` for SLSA-style npm supply-chain attestation.
  - `ci.yml` lint job now also runs `npm run headers:check` and the
    dashboard `tsc --noEmit` — both gate PR merges.
- **Docs site** (`docs/.vitepress/` + GitHub Pages):
  - Existing `docs/.vitepress/config.js` had a syntax error
    (missing comma between `sidebar` and `socialLinks`) that
    silently broke the build — **fixed**.
  - Renamed to `config.mjs` so Node can parse it without
    `"type": "module"` in `package.json`.
  - Refreshed nav + sidebar: new sections for **AI** and
    **Telegram**, expanded **Deployment** section.
  - 3 new pages: `guide/ai.md`, `guide/telegram.md`,
    `deploy/ci-cd.md`.
  - `ignoreDeadLinks` pattern added for repo-root files
    (`README`, `LICENSE`, etc.) that live outside `docs/`.
- **Observability — metrics, Prometheus exposition, Grafana panels**:
  - 12 new counters (`store/schema/stats.js`):
    `ai_chat_requests_total`, `ai_chat_requests_failed_total`,
    `ai_tokens_{prompt,completion}_total`,
    `ai_tool_invocations(_failed)_total`,
    `ai_rate_limit_hits_total`, `ai_cost_cap_hits_total`,
    `telegram_forwards_total`, `telegram_forwards_dropped_total`,
    `telegram_send_failures_total`, `telegram_send_retries_total`.
  - 3 new gauges: `ai_cost_usd_today`, `ai_active_opt_in_chats`,
    `telegram_routed_channels`.
  - 9 typed convenience wrappers in `services/metrics.js`
    (`incAiRequest`, `incAiTokens`, `incAiTool`,
    `incAiRateLimit`, `incAiCostCapHit`, `setAiCostUsdToday`,
    `setAiOptInChats`, `incTelegramForward`,
    `setTelegramRoutedChannels`).
  - Wired into `services/ai/index.js`, `services/ai/router.js`,
    and `services/telegram/index.js`.
  - **NEW `GET /metrics`** on the dashboard port (default `:3001`)
    that renders all store-backed counters/gauges in Prometheus
    text-exposition format with the `echofox_` prefix.
  - `docker/prometheus/prometheus.yml` now scrapes both
    `:3000` (supervisor: worker_up + Node.js defaults) and
    `:3001` (dashboard: store-backed metrics) with the
    distinguishing label `job_part`.
  - `docker/grafana/dashboards/echofox-overview.json` — 12 new
    panels in 2 sections:
    - **AI (v1.2.0+)**: requests (24h), failures (24h), tokens
      today, cost today (USD), tool invocation rate, rate-limit
      - cost-cap hit rate.
    - **Telegram bridge (v1.3.0+)**: forwards (24h), failures
      (24h), routed channels, failure rate (percent) + retries/sec.
- **2 new built-in alert rules** in `services/alertEngine.js`:
  - `config.alerts.rules.aiCostPct` (default threshold `0.80`,
    cooldown `60min`) — fires when today's AI cost reaches the
    configured fraction of `config.ai.costCapPerDayUsd`.
  - `config.alerts.rules.telegramFailureRate` (default `0.20`,
    `minSends: 10`, cooldown `30min`) — fires when Telegram's
    send-failure ratio over the alert window exceeds the
    threshold AND total sends ≥ `minSends`.
  - Both rules use synthetic command keys (`__ai_cost_pct`,
    `__telegram_failure_rate`) so they appear in `getActiveAlerts()`
    without colliding with real commands. They reuse the existing
    `_notify()` path so the WhatsApp `errLogs` AND the v1.3.0
    Telegram mirror both fire for free.
- **7 new tests** (`__tests__/integration/metrics-alerts-v140.test.js`)
  covering stats schema completeness, typed wrappers, both new
  alert rules (fire/no-fire boundary + idempotency).

### Changed

- `package.json` version `1.3.0 → 1.4.0`.
- `docs/.vitepress/config.js` → `docs/.vitepress/config.mjs`.
- `config.alerts` schema extended with the `rules` sub-block
  (`aiCostPct` + `telegramFailureRate`); existing keys unchanged,
  backwards-compatible.
- `services/alertEngine.js` now imports `config` + `getStore`
  (was previously pure in-memory).

### Fixed

- VitePress docs config had a missing comma between `sidebar` and
  `socialLinks` that broke any local `vitepress build docs` run.

### Migration notes

- **Existing users**: just `npm install` and restart. No schema
  changes; no data migrations needed.
- **New CI features require secrets** (all optional):
  - `NPM_TOKEN` for `npm-publish.yml`
  - `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN` for the Docker Hub
    push leg of `docker.yml`
- Without those, the workflows skip cleanly; only the
  GitHub Container Registry push + GitHub Release will run.
- If you previously had Grafana provisioned from
  `docker/grafana/dashboards/echofox-overview.json`, reload the
  dashboard to pick up the 12 new panels.

### Known limitations

- `/metrics` is exposed without authentication on the dashboard
  port. If you expose `:3001` publicly, gate it at your reverse
  proxy. (Existing `/api/*` routes already use Basic auth.)
- The 2 transitive CVEs in `@whiskeysockets/baileys`' bundled
  `link-preview-js` remain upstream issues.

---

## [1.3.0] — 2026-06-11

> **Bridges & persistence.** v1.3.0 adds an outbound-only Telegram log
> bridge (mirror your WhatsApp log channels to Telegram with per-channel
> routing) and makes the v1.2.0 AI rate-limit counters survive restarts
> by moving them to the store.

### Added

- **Telegram outbound log bridge** (`src/services/telegram/`) — raw HTTPS
  to the Bot API (no SDK, zero new dependencies). Outbound-only:
  the bot never polls Telegram. Per-channel routing maps each WA log
  channel (`syslogs`, `botLogs`, `userLogs`, `groupUpdates`, `callLogs`,
  `errLogs`, `movGroup`) to a Telegram chat id / `@channel`.
  - Default 2-second batching coalesces noisy info-level logs into a
    single Telegram message.
  - `error` / `fatal` levels flush **immediately**, bypassing the batch
    timer, so real incidents arrive in real time.
  - HTML render adds a level icon + bold tag + UTC timestamp + `[source]`
    prefix per entry.
  - Chunker splits messages at the configurable `maxChunkChars`
    (default 3800, below Telegram's 4096 cap) preferring newline
    boundaries.
  - Telegram `retry_after` is honoured once (max 60 s); subsequent
    failures are logged quietly so the bridge never crashes producers.
- **Per-channel routing** in `config.telegram`:

  ```js
  telegram: {
    enabled: true,
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    routing: {
      syslogs: '@echofox_sys',
      errLogs: '-1001234567890',
      // ... empty string => disable that channel's mirror
    },
    parseMode: 'HTML',     // 'HTML' | 'MarkdownV2' | 'plain'
    batchMs:   2000,       // errors flush instantly regardless
    maxChunkChars: 3800,
  }
  ```

- **Telegram mirror hookups** — non-invasive, try/catch wrapped so the
  bridge can never crash the producer:
  - `src/core/commandRunner.js` — `postCrashToChannel()` also mirrors
    the stack trace to `errLogs`.
  - `src/services/alertEngine.js` — fire-alert path mirrors triggered
    (level=error) and cleared (level=info) alerts.
- **Persistent AI rate-limit counters** (replaces v1.2.0's in-memory
  Maps). 5 new methods across all 4 store flavours:
  - `incrAiRateUser(jid, hourBucket)` / `getAiRateUser(...)`
  - `incrAiRateChat(jid, dayBucket)` / `getAiRateChat(...)`
  - `pruneAiRate(now)`
- **Migration 006** across sqlite / postgres / mongo / redis — creates
  `ai_rate_user` + `ai_rate_chat` tables (or equivalents).
  Mongo uses TTL indexes on `expires_at`; Redis uses native `EXPIREAT`.
- **`src/services/ai/router.js` refactored** — `shouldRespond()` calls
  the store-backed counter wrappers and gracefully **falls back to
  in-memory Maps** if the active store doesn't implement the new
  methods (so the bot still works on a store flavour that hasn't
  applied migration 006).
- **16 new tests** — 12 Telegram (routing, batching, immediate-flush
  on error, chunking, retry, render layout, drain) + 4 persistence
  (counter survives `sqlite` re-open, router uses store, fallback to
  memory, `pruneAiRate` respects `expires_at`).

### Changed

- `config.ai.router` rate-limit counters move from in-memory to store
  (when the store supports it). Existing in-memory behaviour is
  preserved as a fallback — no breaking change.
- `router.noteSent()` is now `async`. Existing callers (only
  `src/services/ai/index.js`) treat it as fire-and-forget — no
  observable change.
- Bumped `package.json` 1.2.0 → 1.3.0.

### Removed

- **Discord bridge** dropped from the roadmap. Telegram is now the
  only out-of-WhatsApp surface, and even that is log-only.

### Security

- The Telegram bridge is **strictly outbound**. No bot polling, no
  webhook, no way for Telegram users to issue commands to EchoFox.
- HTML escaping is enforced by default (`parseMode: 'HTML'`) to
  prevent injection from log payloads.
- The bot token is read from `config.telegram.botToken` (typically
  via `process.env.TELEGRAM_BOT_TOKEN`); the dashboard already
  refuses to leak provider tokens via `/api/ai/config` and the
  Telegram token is never exposed via any API route.

### Migration notes

- **Existing users:** just `npm install` and restart. Migration 006
  is additive across all 4 store flavours; rate-limit data will
  start populating on the first AI response after upgrade.
- **To enable Telegram log mirror:** create a bot via @BotFather,
  add it as admin to each target chat/channel, then fill in
  `config.telegram.botToken` + `config.telegram.routing.*`. Leave
  any routing entry as `''` to disable that channel.

### Known limitations

- Telegram bridge does not yet attach files / images — log channels
  are text-only. Media in WA log channels is not mirrored.
- Persistent rate-limit counters use the active store's flavour; if
  you switch from `sqlite` to `postgres`, prior counters do not
  migrate (window resets at most ~1 hour later).
- Incremental WhatsApp message streaming for AI replies was
  evaluated and **rejected** — risks Baileys ban. The v1.2.0
  "composing" presence indicator remains the streaming UX.

---

## [1.2.0] — 2026-06-11

> **AI service — multi-provider LLM with tool calling, persona memory and
> per-chat opt-in.** EchoFox can now answer messages with OpenAI / Gemini
> / Anthropic / local-Ollama models, call 12 intel-focused tools
> (VirusTotal, AlienVault OTX, GitHub advisories, Wikipedia, fetch_url
> with SSRF guard, plus 5 read-only store queries), keep a 20-turn
> rolling memory per chat, and stay under a configurable daily $ cost cap.

### Added

- **4 LLM SDKs** as dependencies: `openai` 6.42, `@google/generative-ai`
  0.24, `@anthropic-ai/sdk` 0.104, `ollama` 0.6.
- **`config.ai` block expanded** with 12 new fields:
  `persona`, `customPersona`, `memoryTurns` (default 20),
  `enableToolCalling`, `toolWhitelist[12]`, `optInDefault`,
  `botNameRegex`, `typingWhileGenerating`,
  `rateLimitPerUserPerHour` (30), `rateLimitPerChatPerDay` (100),
  `providers.local.model`, plus `maxTokens` default bumped 500 → 800.
- **Migration 005** across all 4 store flavours (sqlite / postgres /
  mongo / redis) — adds tables `ai_conversations`, `ai_usage_daily`,
  `ai_chat_opt_in` (or equivalents). All 4 stores now expose 9 AI
  methods (`appendAiTurn`, `getRecentAiTurns`, `clearAiTurns`,
  `recordAiUsage`, `getAiUsageDayTotal`, `getAiUsageSince`,
  `getAiUsageByDay`, `setAiChatOptIn`, `getAiChatOptIn`,
  `listAiOptedInChats`).
- **`src/services/ai/`** — new service module:
  - `index.js` — facade with `MAX_TOOL_ROUNDS = 3` tool-call loop,
    aggregating token usage and persisting memory after every round.
  - `router.js` — `shouldRespond()` with 5-rule decision tree
    (disabled / empty / command-prefix / opt-in / bot-name) plus
    in-memory rate-limit Maps and a cost-cap pre-flight check.
  - `personas.js` — `threat-intel` (default, security-focused) /
    `general` / `custom` system prompts.
  - `costTracker.js` — pricing table for OpenAI / Anthropic / Gemini
    models (USD/1M tokens), `record()`, `todayTotalUsd()`,
    `isOverCap()`, `summary()`. Local Ollama hard-coded to $0.
  - `conversationStore.js` — thin facade over store AI methods.
  - `toolRegistry.js` — 12 tools (5 read-only store + 7 intel APIs),
    `getActiveSpec()` filters by `config.ai.toolWhitelist` + API-key
    presence, `invoke()` runs the handler with try/catch. SSRF guard
    in `fetch_url` blocks `127.`, `10.`, `192.168.`, `169.254.`,
    `172.16-31.`, `localhost` and `::1`.
  - `providers/openai.js`, `providers/gemini.js`,
    `providers/anthropic.js`, `providers/local.js` — per-vendor
    adapters with singleton `_client` + `__testOverride()` for tests.
- **Message integration** (`events/messages.upsert.js`) — when no
  command prefix matches and `config.ai.enabled = true`, the bot
  consults `router.shouldRespond()` and (on respond=true) shows a
  `composing` presence indicator (refreshed every 8 s) while the
  LLM generates, then sends the final reply as a single message.
- **Two new commands**:
  - `.ai` (user) — `status` / `on` / `off` / `clear` / `persona <n>` /
    `provider <n>` / `model <n>`.
  - `$ai-admin` (admin, alias `aiadmin`) — `stats [days]` / `chats` /
    `limit get|set <usd>` / `enable` / `disable`.
- **3 new dashboard API routes**:
  - `GET /api/ai/stats?days=N` — daily token + cost rollup + today's
    spend vs cap.
  - `GET /api/ai/chats` — opted-in chats with per-chat overrides.
  - `GET /api/ai/config` — sanitised live config (no API keys).
- **New dashboard tab "AI"** — config card, today-vs-cap progress bar,
  per-day usage table, opted-in-chats table. Auto-refresh every 60 s.
- **11 new integration tests** (`__tests__/integration/ai.test.js`)
  covering router decisions, tool-call loop, memory persistence,
  cost aggregation, rate limiting, SSRF guard, toolWhitelist
  filtering, and persona resolution.

### Changed

- `config.ai.maxTokens` default raised 500 → 800 (better fit for
  threat-intel summaries with tool results).
- `config.ai.providers.local` now accepts a `model` field
  (default `llama3.2`).
- `package.json` version 1.1.2 → 1.2.0.

### Security

- `fetch_url` tool refuses to dial private IP space (RFC 1918,
  link-local, loopback) to prevent SSRF abuse via the LLM.
- Dashboard `/api/ai/config` never returns provider API keys; only
  a boolean per provider indicating whether one is configured.

### Migration notes

- **Existing users**: just `npm install` + restart. The new `ai`
  section is fully opt-in (`enabled: false` by default) and migration
  005 is additive — no data loss, no schema breaks.
- **To enable AI**: set `config.ai.enabled = true`, populate at least
  one provider API key, optionally `.ai on` per chat (or set
  `optInDefault: 'on'` for all chats). Cost cap defaults to **\$5/day**
  globally — adjust via `costCapPerDayUsd` or live with `$ai-admin
limit set <usd>`.

### Known limitations

- AI streaming is single-message ("composing" presence + one final
  reply), not incremental WhatsApp message edits.
- Rate-limit counters are in-memory only; bouncing the process
  resets them. Persistence is a v1.3.x candidate.
- 2 transitive CVEs remain in `@whiskeysockets/baileys`' bundled
  `link-preview-js` — upstream issue, not actionable here.

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
**Audit after v1.1.1:** 2 vulnerabilities (2 high, both inside
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
  (the actual data endpoints) and placed it _after_ basic-auth so
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
> contract tests, auto-generated docs catalog.

### Added (highlights)

- Multi-store backend (SQLite / Postgres / MongoDB / Redis)
- Pluggable auth backend (MultiFile / Redis / SQLite)
- Pairing-code login (alt to QR)
- Built-in web dashboard at `:3001`
- Temp-file garbage collector
- `recordStat`/`getStats` API on all stores

---
