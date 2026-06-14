# EchoFox v1.4.3 — CI hotfix release 🛠️🩹

A pure plumbing release that fixed 4 issues from v1.4.2:

1. `src/dashboard/server.js` — restored the `emit()` helper closure that
   was broken when it was moved out of the `/metrics` route handler.
2. 28 pre-existing ESLint warnings cleaned up across the tree.
3. `dashboard/package-lock.json` uncommented from `.gitignore` and committed
   (so `release.yml`'s `cd dashboard && npm ci` works).
4. TruffleHog `secret-scanning.yml` event-conditional fix re-applied
   (didn't make it onto main in the v1.4.2 push).

A follow-up commit (`f01dcfa "CI fix"`) also changed `.prettierrc.json`
`endOfLine: "lf"` → `"auto"` to stop Prettier flagging CRLF-committed
files as needing re-conversion.

## Upgrading

Drop-in from v1.4.2:

```bash
git pull && npm install
```

— EchoFox v1.4.3 · 2026-06-13
