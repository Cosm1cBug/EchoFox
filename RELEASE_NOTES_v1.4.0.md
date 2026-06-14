# EchoFox v1.4.0 — Ops polish: CI/CD + docs + observability 🛠️📊

v1.4.0 isn't about new bot features — it's about making the bot easy
to release, easy to monitor, and easy to read about. We close the two
long-standing roadmap items (CI/CD auto-release + VitePress docs site)
and add a full observability slice across AI + Telegram.

## TL;DR

- **`git push origin v1.4.0`** now triggers **4 workflows in parallel**:
  GitHub Release with notes + tarball, multi-arch Docker images
  (GHCR + Docker Hub), npm publish with provenance, and docs site
  deploy to GitHub Pages.
- **12 new Prometheus metrics + 12 new Grafana panels** for AI and
  Telegram (request rate, token usage, USD spend, tool failures,
  rate-limit/cost-cap hits, Telegram forwards/failures/retries).
- **2 new built-in alerts**: AI cost > 80% of cap, Telegram failure
  rate > 20% (with cooldown + minimum-traffic gate to silence noise).
- **VitePress docs site refreshed**: covers AI (v1.2), Telegram
  (v1.3), CI/CD (this release). Build was broken by a syntax error
  pre-v1.4.0 — **fixed**.
- **CI now gates** PR merges on AGPL headers + dashboard typecheck.

## Releasing a new version end-to-end (v1.4.0 model)

```bash
# Bump version, write CHANGELOG + RELEASE_NOTES_v<v>.md
git commit -am "chore(release): v1.4.0"
git push origin main

# Single tag push triggers everything in parallel
git tag v1.4.0
git push origin v1.4.0
```

Within ~5 minutes:

1. `release.yml` creates the GitHub Release with `RELEASE_NOTES_v1.4.0.md`
   as the body and `echofox-1.4.0.tar.gz` attached.
2. `docker.yml` pushes `:1.4.0`, `:1.4`, `:latest`, `:sha-<short>`
   tags to both `ghcr.io/cosm1cbug/echofox` and Docker Hub
   for `linux/amd64` + `linux/arm64`.
3. `npm-publish.yml` publishes `echofox@1.4.0` to the npm registry
   with `--provenance` for SLSA attestation. Skips quietly if
   the version is already there.
4. `docs.yml` builds the VitePress site and deploys to
   `https://cosm1cbug.github.io/echofox/`.

## What you can monitor now

### Prometheus

`echofox` job now scrapes two targets:

| Port    | Source                            | Owns                                      |
| ------- | --------------------------------- | ----------------------------------------- |
| `:3000` | supervisor (`bootstrap.js`)       | `echofox_worker_up`, Node.js defaults     |
| `:3001` | dashboard (`dashboard/server.js`) | All `echofox_ai_*` + `echofox_telegram_*` |

Both labelled with `job_part: supervisor|dashboard` so PromQL queries
can disambiguate.

### Grafana

Re-provision `docker/grafana/dashboards/echofox-overview.json` and
you'll see two new sections at the bottom:

- **AI (v1.2.0+)** — 6 panels:
  - Stats: AI requests (24h), failures (24h), tokens today, cost
    today (USD with currency unit).
  - Timeseries: tool invocation rate (success + failure),
    rate-limit + cost-cap hit rate.
- **Telegram bridge (v1.3.0+)** — 4 panels:
  - Stats: forwards (24h), failures (24h), routed channels.
  - Timeseries: failure rate (percent) + retries/sec.

### Built-in alerts

| Rule                  | Default trigger                                       | Mirror destinations                     |
| --------------------- | ----------------------------------------------------- | --------------------------------------- |
| `aiCostPct`           | today's cost ≥ 80% of `costCapPerDayUsd`              | WhatsApp `errLogs` + Telegram `errLogs` |
| `telegramFailureRate` | failure-rate ≥ 20% over alert window, with ≥ 10 sends | WhatsApp `errLogs` + Telegram `errLogs` |

Both have independent `cooldownMinutes` (60 + 30 default). Disable
either via `config.alerts.rules.<rule>.enabled = false`.

## CI / PR gating

The lint job in `ci.yml` now also runs:

```yaml
- name: Check AGPL headers
  run: npm run headers:check

- name: Dashboard install + typecheck
  run: |
    cd dashboard
    npm ci
    npx tsc -b --noEmit
```

Either failure blocks the PR. If `headers:check` fails locally, run
`npm run headers` to auto-add them.

## Required secrets (all optional)

| Secret                                   | Used by                 | Effect if missing                                |
| ---------------------------------------- | ----------------------- | ------------------------------------------------ |
| `NPM_TOKEN`                              | `npm-publish.yml`       | npm publish step fails (other releases continue) |
| `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN` | `docker.yml`            | Docker Hub push fails; GHCR push still works     |
| `GITHUB_TOKEN`                           | release.yml, docker.yml | auto-injected by GitHub                          |

## Docs site

Now organised around the v1.2/v1.3/v1.4 reality:

- **AI** — full reference for personas, tools, cost control, commands.
- **Telegram** — 3-minute setup, channel keys, format, reliability.
- **CI/CD** — release flow, image tags, required secrets,
  end-to-end release walkthrough.

Browse at https://cosm1cbug.github.io/echofox/.

## Upgrading from v1.3.x

1. `git pull` and `npm install` (no new deps).
2. Restart — no migrations in this release.
3. Optionally enable the new alert rules in `config.alerts.rules.*`
   (defaults are conservative — enabled with sensible thresholds).
4. Re-provision Grafana from
   `docker/grafana/dashboards/echofox-overview.json`.
5. Add `NPM_TOKEN` repo secret if you want npm publish; otherwise
   the workflow stays inert.

## Tests

```
$ npm test
# tests 137
# pass 137
# fail 0
```

7 new tests in this release covering metric definitions, typed
wrappers, and both built-in alert rules. All 130 v1.3.0 tests
still pass.

— EchoFox v1.4.0 · 2026-06-11
