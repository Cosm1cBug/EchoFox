# Hardening and validation runbook

These changes are **unreleased**. A package/image or an older tag is not evidence that it contains this branch. Read [implementation status](./REMEDIATION_STATUS.md) before deployment. This is not a production-capacity or security certification.

## Configuration without starting the bot

Use Node **22.12 or later**. From a checkout:

```bash
npm ci
cp src/config.example.js ./echofox.config.cjs
# Edit the file locally; never paste credentials into issue/chat/CI logs.
ECHOFOX_CONFIG=./echofox.config.cjs npm run config:check
npm run build:dashboard
# Starts WhatsApp/network connections; do this only in the intended environment:
node scripts/cli.js start --config ./echofox.config.cjs
```

Keep external configuration outside the checkout when it contains credentials; restrict its permissions to its service account. The sample path above is for illustration, **not an instruction to commit it**. Prefer `ECHOFOX_CONFIG=/absolute/private/path/config.cjs` in production. The loader does not create a source-tree config file anymore. Without an explicit file it uses existing `src/config.js`, then the committed example, then schema defaults. A missing explicit file is an error, not silent fallback.

Canonical values override legacy values **per field**. All 15 newer configuration sections are preserved. Environment overrides resolve actual schema paths and support compact and snake-case aliases:

```bash
ECHOFOX_STOREDB_TYPE=SQLITE
ECHOFOX_BOT_ADMIN_PREFIX='$'
ECHOFOX_PRIVACY_STORE_MESSAGE_BODIES=false
ECHOFOX_AI_PROVIDERS_OPENAI_APIKEY='<set privately, not in shell history>'
ECHOFOX_AI_MAX_INPUT_BYTES=65536
ECHOFOX_AI_PRICING='{"openai:operator-reviewed-model":[1,2]}'
```

Strings remain strings (including numeric-looking keys/phone numbers); booleans must be `true` or `false`. Arrays/maps/whole sections use JSON. More-specific leaf overrides win over whole-section JSON. Conflicting aliases, unknown variables, invalid JSON/types, and prototype keys fail validation. Use dotted-string form for a WhatsApp web-version environment override; arrays remain supported in config files.

`config:check` prints feature flags, source path, backend choices and credential **presence**, not credential values. User-supplied JavaScript config is trusted executable code: it can itself print things; do not load an untrusted config file.

## Privacy and AI consent

- `privacy.storeMessageBodies=false` blocks message edit-body writes, body/cache reads, SQLite message lists, and AI memory through the shared adapter policy.
- `privacy.excludeFromStore` is enforced on those paths and on excluded-chat timeline writes. The edit event handler also checks it before metadata/edit processing.
- `ai.memoryTurns=0` means no durable AI memory and no retrieval of old memory, but the current prompt still reaches the provider for an admitted request.
- Existing stored content is hidden by the policy, **not automatically purged**. Inventory message bodies, edits, AI/tool turns, exports, timelines and backups before an owner-approved historical purge/retention migration. Other metadata surfaces are still being audited.
- Explicit `.ai off` beats mentions **and all paid command entry points**, including `.ask`, `.explain`, `.summarize` and `.imagine`. Commands can work with an unset ambient preference; they cannot override explicit opt-out. Re-enable intentionally with `.ai on`.
- Private mode rejects non-admin AI fallback before provider calls. Group membership is not permission to read another chat. Global blocklist/newsletter tools are configured-admin-only; chat tools remain scoped to the originating chat even for admin sessions.

Provider/tool output is untrusted data. These controls are not a general prompt-injection or model-quality guarantee.

## Spending and quotas

Every paid entry point uses common policy, quota and budget admission. Attempts consume persistent per-user/per-chat quota before provider work, including attempts that later fail. Successful `noteSent` is no longer the admission mechanism.

Admission serializes **inside a single process**. Independent bot replicas/processes need a shared transactional reservation/quota ledger before they can claim a global limit. Redis usage increments now use one atomic Lua operation, but cross-replica reservations are still not implemented or certified.

Reservations include bounded prompt bytes, completion tokens and all allowed tool rounds. `ai.maxInputBytes`, `ai.maxToolResultBytes`, and `ai.maxToolCallsPerRound` bound the tool loop. Unknown token prices fail closed; reviewed custom prices use `ai.pricing['provider:model'] = [inputUSDPerMillion, outputUSDPerMillion]`.

Built-in rates are estimates, **not verified current provider invoices**. A provider can change rates or return unexpected metering/model names. Unmetered and uncertain calls are recorded under `:unmetered-estimate` / `:unconfirmed-estimate`, not silently counted as free. Reconcile those rows against provider billing. A ledger-write or unexpected-price fault blocks further paid admission in that process; repair/reconcile before restarting. Restarting alone does not reconcile uncertain usage.

Images use fixed-price `dall-e-3` by default (1024 square or 1792 rectangular; standard/HD). `dall-e-2` supports 256/512/1024 standard. Unsupported variable-price models/combinations deny instead of borrowing an unrelated fixed charge. Verify model availability and current prices with the provider before enabling images. Raw dollar charges are recorded before download/delivery, so a failed send cannot erase a billed generation.

These are admission controls, not an absolute guarantee about external billing.

## Public URL fetching and networking

AI URL fetch, RSS, MediaFire and generated-image downloads use a shared policy:

1. Only HTTP(S), no URL credentials.
2. Canonical IPv4/IPv6 range checks, including hexadecimal IPv4-mapped IPv6.
3. Fail on DNS errors/empty answers/any non-public answer.
4. Bind validated addresses to the actual HTTP(S) connection lookup; retain original hostname and normal TLS certificate verification.
5. No redirects by default. Explicit MediaFire redirects are bounded and each hop is revalidated/pinned; HTTPS downgrade is refused.
6. Bounded buffered responses; streaming through this helper is not supported.

A DNS preflight alone is **not** a rebinding defense. Public-URL fetching currently refuses configured proxies: proxy-side DNS cannot be pinned by this process. This intentionally fails closed, rather than silently bypassing a configured proxy. Trusted configured-provider endpoints (including local Ollama) are a different policy surface. Complete the remaining user-derived outbound-URL inventory and design a DNS-pinning-capable proxy/egress policy before claiming blanket SSRF coverage. Invalid configured proxy/extra-CA setup now fails rather than silently falling back; TLS verification is not disabled.

## Dashboard

- Enabled dashboard requires nonempty username and a strong non-template password.
- Default bind is `127.0.0.1`. In a container set `ECHOFOX_DASHBOARD_HOST=0.0.0.0`, keep published host ports loopback-only, and terminate TLS at a trusted reverse proxy. Browser API requests remain relative URLs.
- Only failed authentication consumes the bounded per-IP failure budget. Successful polling is not globally rate-limited or double-counted. Configure `authMaxFailures` / `authWindowMs` and a correct, narrow `trustProxy`; never trust arbitrary forwarded addresses.
- Mutations require `X-EchoFox-Request: 1` and refuse cross-origin browser requests. The bundled frontend supplies it. Non-browser API clients must add it too.
- Build before startup. `dashboard.buildOnBoot=false` by default avoids a background install/build in production. Missing output serves maintenance; once a manual/opted-in background build appears, routes recover without restart.
- Configured dashboard admins are fully trusted over the bot's exposed data/actions. The current dashboard server does not expose a general OS-shell execution endpoint; the earlier report's shell warning is not evidence such an endpoint exists in this checkout.

## Credentials, containers and observability

Credential/error/URL log sanitization is always on, including logger child bindings. Optional `privacy.minimiseLogs` additionally strips body fields. Crash notifications to WhatsApp/Telegram carry correlation references, not command bodies/raw errors/stacks. This does not complete the audit of every diagnostic/export or external library's own console output.

`data/` and operator `secrets/` are excluded from Git/Docker contexts; npm excludes runtime sessions/databases/backups and checks the actual archive. Do not put custom credential directories inside distributable source. Fresh image session directories have private permissions, but existing mounted volumes/custom auth paths need a permission review; no live credentials were migrated or chmodded by this work.

Compose keeps the legacy session volume **and** adds `/app/data` persistence for fresh `data/sessions` configurations. Do not delete or move an existing pairing volume as part of an update. Container execution has not been validated here (Docker unavailable).

Prometheus has separate supervisor/dashboard scrape jobs; `basic_auth` is on the dashboard **job**, not a `static_configs` entry. Prometheus does not perform arbitrary `${ENV}` substitution in its YAML. Match the static username to your dashboard config and provision its password through the `metrics_dashboard_password` secret file (`METRICS_DASHBOARD_PASSWORD_FILE` on the Compose host). UID **65534** must be able to read it; local Compose file secrets preserve host permissions, so use proper ownership/ACLs rather than making it world-readable. Do not store the file in Git. Grafana now also reads a distinct `grafana_admin_password` file secret (`GRAFANA_ADMIN_PASSWORD_FILE`, default `./secrets/grafana-admin-password`), with no `changeme` fallback. Make it readable to Grafana UID **472**, not world-readable. Grafana's host port is now **3002**, avoiding a collision with dashboard port 3001.

Run `promtool check config` and an authenticated live scrape in the actual environment. YAML structure tests are not promtool/live validation. Worker health now observes exit/signal status, rather than treating `killed=false` as proof a naturally exited child is alive. Existing `NODE_OPTIONS` are preserved. No restart/backoff/shutdown ownership behavior was repaired.

## Verification, artifacts and release

```bash
npm run lint
npm run format:check
npm run headers:check
npm test
npm run test:contract
npm run build:dashboard
npm run audit:production
npm run secrets:check
npm run license:check
npm run verify
```

- Tests keep the 60-second file deadline; CI test step/job limits remain. Diagnose a hang with `TEST_RESOURCE_DIAGNOSTICS=1 npm test` (resource types/counts before the deadline). This does not force exit, skip tests, extend deadlines or prove a root cause.
- A command timeout is not cancellation. Until commands/providers cooperate with cancellation, a timed-out operation may still run or spend money. Replies now state that honestly. Cooperative cancellation remains pending.
- Root **and dashboard** production audits fail on high/critical findings or an unavailable/malformed registry result. The latest root report has **two moderate findings**, not zero; the dashboard has zero. See [dependency review](./DEPENDENCY_REVIEW.md) for the targeted ASF sticker guard and still-required dependency migration. A severity-threshold pass is not dependency safety, license compliance, native-build compatibility or a substitute for reviewing deprecated/EOL packages.
- Pre-push consumes Git's actual ref updates and scans all outgoing commit spans, including secrets added then removed before HEAD. Full changed blobs cover merge resolutions and binary data, and annotated push-object messages are inspected. Worktree/untracked files (including binary patterns) are also scanned. Only locations/categories are printed, never matched credentials. This pattern scanner complements, not replaces, TruffleHog/security review.
- Build uses dashboard `npm ci`, typecheck and the declared build script. Required release build/archive steps cannot succeed via `|| true` fallbacks. Workflow actions are SHA-pinned; Docker workflow remote enablement was **not** changed.
- `npm pack` requires the frontend build; `node scripts/check-package.js /path/to/echofox-version.tgz` verifies the actual archive's frontend, CLI, build inputs and obvious runtime-secret exclusions. Source archives retain both lockfiles and frontend TypeScript configs.
- Runtime CLI: `echofox --version`, `echofox config:check --config /private/config.cjs`, `echofox start --config /private/config.cjs`. Config-check/version/help do not start pairing, worker or health services.

**Current release blocker:** root `LICENSE` identifies MIT while package metadata/headers/NOTICE identify AGPL. The new consistency gate deliberately fails. Owner/contributor provenance review must decide the correct resolution; this work does not choose or rewrite the license. Publishing remains blocked, not made green by skipping the check. Also review current prices, credentials/account policy, native/container compatibility and live acceptance results before an owner-authorized release. Do not weaken account 2FA, retag an existing release, or assume a registry/network error means a version is unpublished.

## Explicitly unfinished acceptance work

- Privacy retention/historical purge and complete metadata/export audit.
- Remaining untrusted outbound inventory, proxy policy and file-permission audit.
- PG/Mongo/Redis readiness, migrations and live query/ledger parity.
- Durable backpressure/outbox, crash-recovery idempotency and delivery guarantees.
- Backup startup wiring, resolved paths, correct encryption/restore format and a real restoration drill. The existing backup scaffold is **not** a certified recovery mechanism; do not trust a file's existence as restore proof.
- Cooperative request/command cancellation and root-cause verification for intermittent resource hangs.
- Full promtool, Docker, real providers, WhatsApp/device smoke, and 48–72 hour soak.
- Owner-approved repository governance/settings and license/provenance decisions.
- Representative load/retention benchmarks. No supported users/chats/messages-per-second capacity number has been established; record hardware, payloads, p95 latency, queue occupancy, RSS/heap growth, DB size and failure behavior before setting limits.

**Shutdown/reconnect remains excluded by the user:** no replacement of routine logout, lifecycle write/adapter-close waiting, socket/auth ownership repair, or reconnect ownership tests are included.
