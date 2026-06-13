# EchoFox v1.4.1 — Hotfix 🩹

A small patch release that fixes a pre-existing runtime bug and tidies
the `.gitignore`. No new features, no config changes — pure plumbing.

## What's fixed

- 🐛 **`sqliteStore.getGroupMetadata` crash on unknown JIDs.** A stray
  `F` character on line 455 of `src/store/sqliteStore.js` caused a
  `ReferenceError: F is not defined` whenever the method was called
  for a JID with no row in the `groups` table. In practice this hit
  the first time the bot saw a message in a freshly-joined group,
  before metadata had been fetched. The typo predated v1.2.0; this
  release removes the single character.

## What's cleaner

- 🧹 **`.gitignore`** — added patterns for `*.tsbuildinfo` (TypeScript
  incremental build info that `tsc --build` writes during the dashboard
  typecheck step) and `dashboard/package-lock.json` so they stop
  showing as untracked in `git status` after standard install/build.

## Upgrading

Drop-in upgrade from v1.4.0:

```bash
git pull && npm install