# EchoFox v1.0.2 — Crash-bug hotfix 🩹

A short but important hotfix addressing 4 latent crash bugs surfaced by
deeper audit + ESLint analysis after v1.0.1 shipped.

## TL;DR

- 🚨 **Fixed dashboard boot crash** (v1.0.1 regression — duplicate `dashboardLimiter`)
- 🚨 **Fixed Redis/SQLite/Postgres auth crash** (missing Baileys import)
- 🚨 **Fixed worker reconnection crash** (undeclared constant)
- 🚨 **Fixed newsletter event crash** (wrong destructure + typo)

## Who needs this update

**Everyone on v1.0.0 or v1.0.1.** All four bugs trigger in common
production paths:

- v1.0.1's `dashboard.enabled: true` (the default) → bot crashes at boot
- Any non-default auth backend → crashes at startup
- Any Baileys reconnect (happens regularly) → worker crashes
- Any newsletter event → router-attached handler crashes

## Upgrade

```bash
git pull
npm install         # no new deps; just for safety
npm start
```
