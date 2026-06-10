# EchoFox v1.1.2 — Dashboard tabs for v1.1.0 data 📊

Five new React dashboard tabs surfacing all the v1.1.0 extended-event
data. Plus a quality-of-life fix for the 3 pre-existing TypeScript strict
errors that have been blocking `npm run typecheck:dashboard` since
v1.0.0.

## TL;DR

- **5 new dashboard tabs** — Blocklist, Contacts, Presence, Labels, Newsletters
- **All v1.1.0 `/api/*` routes** now have UI
- **TypeScript strict check passes** (was 3 errors in pre-existing pages)
- **Zero backend changes** — purely a dashboard UI release

## Upgrade from v1.1.1

```bash
git pull
npm run build:dashboard
npm start