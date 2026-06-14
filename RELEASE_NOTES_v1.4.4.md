# EchoFox v1.4.4 — Second CI hotfix 🩹

Two more issues that surfaced after v1.4.3 went through CI.

## What's fixed

### 1. Prettier `format:check` was failing on 228 files

The repo has had Prettier configured since v1.0 but **the CI gate was
never actually enforcing it**. When v1.4.2's stricter `ci.yml` made
`format:check` mandatory, 228 files surfaced with formatting drift:

- Missing trailing newlines on `.yml` / `.json` files
- Multi-line block reformat needed on `.js` files

**Fix**: ran `prettier --write` across the entire tree in one commit.
Pure whitespace + line-wrap changes — **zero functional changes**.
All 147 tests still pass on the reformatted code.

(The `endOfLine: "lf"` → `"auto"` config change was already shipped
separately as `f01dcfa "CI fix"`.)

### 2. TruffleHog action rejecting `--fail --fail`

The trufflesecurity/trufflehog action's internal shim ALREADY appends
`--fail` to whatever's in `extra_args`. Setting `extra_args: --fail`
produced `--fail --fail` on the CLI:

```
trufflehog: error: flag 'fail' cannot be repeated, try --help
```

**Fix**: removed `--fail` from all three `extra_args:` blocks in
`.github/workflows/secret-scanning.yml`. Replaced with
`--results=verified,unknown` (the canonical recommended value from
the official TruffleHog OSS GitHub Action examples).

## Also bundled

- `package.json` version bump 1.4.2 → 1.4.4 (v1.4.3 commit accidentally
  omitted the bump — it was still showing 1.4.2 even after the v1.4.3
  commit landed)
- `RELEASE_NOTES_v1.4.3.md` added retroactively (was missing from v1.4.3)

## Upgrading

Drop-in from v1.4.3:

```bash
git pull && npm install
```

If you have local changes, you may see whitespace-only conflicts on
the 228 reformatted files. Easiest path: `git stash`, `git pull`,
`git stash pop` + `npm run format` on any new code.

## Tests

```
$ npm test
# tests 147
# pass 147
# fail 0
```

Same 147 tests as v1.4.2 / v1.4.3 (no functional changes in any of the
three patch releases).

— EchoFox v1.4.4 · 2026-06-13
