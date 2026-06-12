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