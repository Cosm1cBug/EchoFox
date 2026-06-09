# EchoFox v1.0.1 — Hotfix release 🔒

A small but important hotfix addressing three issues from v1.0.0 plus a resilience pass on all external-API call sites.

## Changes

- 🚨 **Fixed bot crash at boot** when dashboard is enabled
  (`express-rate-limit` missing from `package.json`)
- 🔒 **Eliminated 21 transitive `axios` CVEs** via `npm overrides`
- 🛡️ **Rate limiter now actually protects the right endpoints**
  (`/api` + `/dashboard`, before basic-auth)
- 🧹 **All 10 remaining direct axios calls** now use `axiosWithBreaker`
- 🩹 **Removed 4 duplicate method definitions** in `sqliteStore.js` that
  were blocking CI lint

## Upgrade from v1.0.0

```bash
git pull
rm package-lock.json          # forces npm to honour the new overrides
npm install
npm start