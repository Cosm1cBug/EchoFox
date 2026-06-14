# Release Candidate Checklist

Run through this before tagging a release. Tick each item; ship only
when every box is checked.

## Pre-release validation

### Code health

- [ ] `npm run lint` — 0 errors
- [ ] `npm run headers:check` — all source files have AGPL headers
- [ ] All 4 test suites green: `npm test`
  - [ ] contract (33+ tests)
  - [ ] boot (19+ tests)
  - [ ] messages (24+ tests)
  - [ ] stores (11+ tests)
- [ ] Manual smoke: bot boots cleanly with empty `config.js` (uses example defaults)

### Dashboard

- [ ] `npm run build:dashboard` completes
- [ ] TypeScript: `cd dashboard && npm run typecheck` — 0 errors (or only acceptable pre-existing ones)
- [ ] Visit `http://localhost:3001/dashboard/` — all 6 tabs load without console errors
- [ ] Login → Logout → Login flow works (basic auth)
- [ ] Subscriptions tab shows real data for at least 1 service

### Subscriptions (smoke test in a real WhatsApp DM)

- [ ] `.alienvault on` → `.alienvault -status` → `.alienvault off`
- [ ] `.thehackersnews on malware` → status reflects topics → `off`
- [ ] `.rss add https://hnrss.org/frontpage` → `.rss list` → `.rss remove`
- [ ] `.github watch nodejs/node` → `.github list` → `.github remove`
- [ ] `.vtwatch add hash:44d88612fea8a8f36de82e1278abb02f` → `.vtwatch list`

### Soak (release candidates only)

- [ ] Short synthetic soak passes: `node scripts/soak.js --durationMin=60 --rate=10` → verdict **PASSED**
- [ ] Long real-world soak ≥48h on a deployed instance, leak detector did NOT trigger
- [ ] Heap diff between bootup snapshot and 24h-later snapshot shows < 50 MB total growth

### Backend coverage (run at least one)

- [ ] SQLite: clean boot, all subscriptions work, migrations apply
- [ ] Postgres: same (if you maintain a pg deployment)
- [ ] Mongo: same (optional)
- [ ] Redis: same (optional)

### Storage migrations

- [ ] Run `npm run migrate` against a fresh DB — applies cleanly
- [ ] Re-run — reports "all up to date" with no new applications
- [ ] Tested against a DB that's at v=N-1 — picks up only the new migration

## Release artifacts

- [ ] `CHANGELOG.md` has a complete entry for this version
- [ ] `package.json` version matches the tag you're about to create
- [ ] `RELEASE_NOTES_<version>.md` exists (for GitHub Release body)
- [ ] Any breaking changes are flagged with `### Breaking` in CHANGELOG

## Git hygiene

- [ ] All committed files have LF line endings (run `git add --renormalize .` if needed)
- [ ] No leftover patcher scripts in the repo (`ls _phase*.js _p*.js` should be empty)
- [ ] No debug `console.log` left in source files
- [ ] CI is green on the commit being tagged

## Tagging

```bash
# After all the above pass:
git tag -a v<version> -m "Release v<version>"
git push origin v<version>

# Then create the GitHub Release using RELEASE_NOTES_v<version>.md as the body.
```

## Post-release smoke

Within 1 hour of tag:

- [ ] Docker image built + pushed (CI handles this — verify it ran)
- [ ] Docs site rebuilt with new version (CI handles)
- [ ] Pull the new version on a fresh machine — `npm install && npm start` works without errors
- [ ] At least one user-visible verification: send `.menu` → reply mentions the new version

## Rollback plan

If something breaks within 24h of release:

```bash
# Tag a hotfix bump (e.g. v1.0.1) with the minimal fix
# OR
# Revert the bad commit + re-tag the previous version as -hotfix
```
