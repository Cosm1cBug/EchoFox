# CI/CD pipeline

EchoFox ships seven GitHub Actions workflows that handle lint, tests,
security scans, multi-arch Docker images, npm publish, GitHub Releases,
and docs deployment. This page is the one-stop reference.

## At a glance

| Workflow | File | Trigger |
|---|---|---|
| **CI** | `.github/workflows/ci.yml` | push / PR to `main` or `develop` |
| **Security** | `.github/workflows/security.yml` | push / PR to `main` + weekly cron |
| **Secret Scanning** | `.github/workflows/secret-scanning.yml` | push / PR + manual |
| **Docker** | `.github/workflows/docker.yml` | **v* tag push** + weekly cron + manual |
| **npm publish** | `.github/workflows/npm-publish.yml` | **v* tag push** + manual |
| **Release** | `.github/workflows/release.yml` | **v* tag push** OR version-bump on `main` |
| **Docs** | `.github/workflows/docs.yml` | push to `main` touching `docs/**` |

## CI

Linting + 2-version test matrix (Node 20 + 22). **v1.4.0** added two
gating steps to the lint job:

- `npm run headers:check` — fails the build if any `.js` file in
  `src/` or `scripts/` is missing the AGPL header. Run
  `npm run headers` locally to add them.
- Dashboard install + `npx tsc -b --noEmit` — fails the build if
  the React dashboard has type errors.

A PR cannot merge to `main` if any of these fail.

## Release

A v* tag push (e.g. `git push origin v1.4.0`) runs:

1. `npm ci` + `npm test` + `npm run headers:check` — these gate the
   release; any failure aborts.
2. `cd dashboard && npm ci && npm run build` — produces a fresh
   dashboard build asset.
3. Builds `echofox-<version>.tar.gz` containing `src/`, `scripts/`,
   `dashboard/{src,index.html,vite.config,...}`, `docs/`,
   `Dockerfile`, `docker-compose.yml`, LICENSE, README, CHANGELOG,
   etc. Excludes `node_modules` and `.git`.
4. Creates a GitHub Release. If `RELEASE_NOTES_v<version>.md` exists,
   its content is used as the body; otherwise GitHub's auto-generated
   notes (from commit history) are used.
5. Attaches the tarball as a release asset.

Alternate trigger: a normal push to `main` with a version bump in
`package.json` also triggers the release flow (same gates + outputs).

The `prerelease` flag is auto-set to `true` if the version contains
`beta`, `alpha`, or `rc`.

## Docker

Builds and pushes to **two registries** simultaneously:

- `ghcr.io/cosm1cbug/echofox`
- `docker.io/cosm1cbug/echofox` (requires repo secrets
  `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`)

**v1.4.0** added four image tags per build for clear pinning:

| Tag | Meaning |
|---|---|
| `:1.4.0` | exact version (immutable) |
| `:1.4` | major.minor (auto-updates with patches) |
| `:latest` | always points to the newest stable release |
| `:sha-abc1234` | immutable per-commit tag (debug / rollback) |

Triggers: any `v*` tag push, weekly Monday cron for base-image
security patches, or manual dispatch. Multi-arch (`linux/amd64` +
`linux/arm64`) via Buildx.

## npm publish (v1.4.0 NEW)

Publishes the package to `registry.npmjs.org` on every `v*` tag
push. Requires repo secret **`NPM_TOKEN`** (npm automation token
with publish scope on the `echofox` package).

Safety features:

- `npm ci --ignore-scripts` for supply-chain hygiene.
- `npm test` must pass before publish.
- The tag's version must match `package.json` exactly — mismatched
  tag pushes fail with an explicit error.
- **Idempotent**: skips publish (with a `::notice::`) if the
  version is already on the registry. Safe to re-run.
- Publishes with `--access public --provenance` for SLSA-style
  npm supply-chain attestation.

## Docs

Builds the VitePress site under `docs/` and deploys to GitHub Pages
at `https://cosm1cbug.github.io/echofox/`. Triggered on push to
`main` touching anything under `docs/**`, or manual dispatch.

The workflow uses Pages' modern OIDC-based deploy (no `gh-pages`
branch needed). Permissions are scoped minimally:
`pages: write` + `id-token: write` + `contents: read`.

## Releasing v1.4.0 end-to-end

```bash
# Local
git checkout main && git pull
# bump package.json version, CHANGELOG, RELEASE_NOTES_v1.4.0.md
git commit -am "chore(release): v1.4.0"
git push origin main

# Tag triggers all four release-time workflows in parallel:
#   - release.yml    creates the GitHub Release with notes + tarball
#   - docker.yml     builds and pushes multi-arch images
#   - npm-publish.yml publishes to npm with provenance
# (docs.yml triggers separately on docs/** changes from the main push)
git tag v1.4.0
git push origin v1.4.0
```

## Required secrets

| Secret | Used by | Optional? |
|---|---|---|
| `GITHUB_TOKEN` | release.yml, docker.yml | auto-injected |
| `DOCKERHUB_USERNAME` | docker.yml | yes (skip Docker Hub push if missing) |
| `DOCKERHUB_TOKEN` | docker.yml | yes |
| `NPM_TOKEN` | npm-publish.yml | yes (skip npm publish if missing) |

## Observability hooks

v1.4.0 also exposes new Prometheus metrics for AI + Telegram traffic
on the dashboard port (`:3001/metrics`). Update your Grafana
provisioning from `docker/grafana/dashboards/echofox-overview.json` —
12 new panels (AI + Telegram sections) are included by default.
See [the AI guide](/guide/ai) and [Telegram guide](/guide/telegram)
for the per-metric definitions.
