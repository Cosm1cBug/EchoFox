#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EchoFox — pre-push verification suite
#
# Runs every quality gate that CI runs, locally, BEFORE the push:
#
#   bash scripts/verify.sh            # full suite (deps → lint → tests → build → audit)
#   bash scripts/verify.sh --quick    # fast subset (sync, lint, format, headers, hygiene)
#   npm run verify / npm run verify:quick
#
# Steps (full mode):
#   1.  preflight   Node >= 22.12, npm present
#   2.  deps        npm ci (fresh) or lockfile-sync dry-run check (node_modules exists)
#   3.  dashboard   same for dashboard/ + TypeScript build of both tsconfigs
#   4.  lint        eslint --max-warnings 0
#   5.  format      prettier --check
#   6.  headers     AGPL header check
#   7.  tests       unit/integration suite + command contract tests
#   8.  build       dashboard production build
#   9.  audit       npm audit — FAILS on unaccepted high/critical advisories
#                   in production deps (accepted advisories are documented in
#                   the step; dev-only findings are printed for information)
#   10. secrets     pattern scan of the outgoing diff (API keys, tokens, keys)
#   11. git         whitespace / conflict-marker / tracked-sensitive-file checks
#   12. summary     step scoreboard + diff overview for final review
#
# Env overrides:
#   VERIFY_SKIP_AUDIT=1     skip the dependency audit step
#   VERIFY_SKIP_BUILD=1     skip the dashboard build step
#   VERIFY_SKIP_TESTS=1     skip the test step
#   VERIFY_INSTALL=1        force a full `npm ci` even if node_modules exists
#
# This script detects problems before they reach GitHub; it does NOT guarantee
# a failure-free push. CI remains the authoritative gate.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUICK=0
[[ "${1:-}" == "--quick" || "${1:-}" == "-q" ]] && QUICK=1

# ── output helpers ───────────────────────────────────────────────────────────
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; OFF=$'\033[0m'
if [ ! -t 1 ]; then RED=""; GREEN=""; YELLOW=""; BOLD=""; DIM=""; OFF=""; fi

STEP_WIDTH=14
RESULTS=()
CURRENT_STEP=""

step() { CURRENT_STEP="$1"; printf '%s[*]%s %-*s ' "$BOLD" "$OFF" "$STEP_WIDTH" "$1"; }
ok()   { printf '%sok%s\n' "$GREEN" "$OFF"; RESULTS+=("ok|$CURRENT_STEP"); }
fail() { printf '%sFAIL%s\n' "$RED" "$OFF"; RESULTS+=("FAIL|$CURRENT_STEP"); }
skip() { CURRENT_STEP="$1"; printf '%sskip%s\n' "$YELLOW" "$OFF"; RESULTS+=("skip|$1"); }

run() { # run <cmd...> — capture output, print tail on failure
  local out
  if out=$("$@" 2>&1); then return 0; else printf '%s\n' "$out" | tail -40; return 1; fi
}

# ═════════════════════════════════════════════════════════════════════════════
# 1. preflight
# ═════════════════════════════════════════════════════════════════════════════
step "preflight"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null) || NODE_MAJOR=0
NODE_OK=$(node -e 'const [ma,mi]=process.versions.node.split(".").map(Number);
  process.exit(ma>22||(ma===22&&mi>=12)?0:1)' 2>/dev/null; echo $?)
if [ "$NODE_OK" = "0" ]; then
  ok
else
  fail
  echo "  ${RED}Node $(node --version 2>/dev/null || echo '?') found — EchoFox requires Node >= 22.12.0 (engines field).${OFF}"
  echo "  Fix: install Node 22 LTS (e.g. via nvm: nvm install 22 && nvm use 22)."
  exit 1
fi

# ═════════════════════════════════════════════════════════════════════════════
# 2. dependencies (root) — install fresh OR verify lockfile sync in seconds
# ═════════════════════════════════════════════════════════════════════════════
step "deps:root"
if [ ! -d node_modules ] || [ "${VERIFY_INSTALL:-0}" = "1" ]; then
  if run npm ci --loglevel=error; then ok; else
    fail
    echo "  ${RED}npm ci failed. If the message mentions 'Missing: … from lock file' the${OFF}"
    echo "  ${RED}lockfile is out of sync with package.json — fix with:${OFF}"
    echo "    npm install --package-lock-only && git add package-lock.json"
    exit 1
  fi
else
  if run npm ci --dry-run --loglevel=error; then ok; else
    fail
    echo "  ${RED}package-lock.json is out of sync with package.json (this is what breaks CI in${OFF}"
    echo "  ${RED}the 'Install dependencies' step of every workflow). Re-sync and re-stage:${OFF}"
    echo "    npm install --package-lock-only && git add package-lock.json"
    echo "  (Then re-run: npm run verify)"
    exit 1
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# 3. dashboard deps + typecheck
# ═════════════════════════════════════════════════════════════════════════════
if [ "$QUICK" = "0" ]; then
  step "deps:dash"
  if [ ! -d dashboard/node_modules ] || [ "${VERIFY_INSTALL:-0}" = "1" ]; then
    ( cd dashboard && run npm ci --loglevel=error ) && ok || { fail; exit 1; }
  else
    ( cd dashboard && run npm ci --dry-run --loglevel=error ) && ok || {
      fail
      echo "  ${RED}dashboard/package-lock.json out of sync — fix:${OFF}"
      echo "    cd dashboard && npm install --package-lock-only"
      exit 1
    }
  fi
fi

step "typecheck"
if [ "$QUICK" = "1" ] && [ ! -d dashboard/node_modules ]; then
  skip "typecheck (dashboard deps not installed — full mode installs them)"
else
  TSC_OK=1
  ( cd dashboard && npx tsc -p . --noEmit ) || TSC_OK=0
  if [ "$TSC_OK" = "1" ]; then ( cd dashboard && npx tsc -p tsconfig.node.json --noEmit ) || TSC_OK=0; fi
  [ "$TSC_OK" = "1" ] && ok || fail
fi

# ═════════════════════════════════════════════════════════════════════════════
# 4-6. lint / format / headers
# ═════════════════════════════════════════════════════════════════════════════
step "lint"
run npm run lint --silent && ok || fail

step "format"
run npm run format:check --silent && ok || fail

step "headers"
run npm run headers:check --silent && ok || fail

# ═════════════════════════════════════════════════════════════════════════════
# 7. tests
# ═════════════════════════════════════════════════════════════════════════════
if [ "$QUICK" = "0" ] && [ "${VERIFY_SKIP_TESTS:-0}" != "1" ]; then
  step "tests"
  if run npm test --silent && run npm run test:contract --silent; then ok; else fail; fi
else
  skip "tests"
fi

# ═════════════════════════════════════════════════════════════════════════════
# 8. production build (dashboard)
# ═════════════════════════════════════════════════════════════════════════════
if [ "$QUICK" = "0" ] && [ "${VERIFY_SKIP_BUILD:-0}" != "1" ]; then
  step "build"
  run npm run build:dashboard --silent && ok || fail
else
  skip "build"
fi

# ═════════════════════════════════════════════════════════════════════════════
# 9. dependency audit — hard gate on high/critical in PRODUCTION deps
# ═════════════════════════════════════════════════════════════════════════════
if [ "$QUICK" = "0" ] && [ "${VERIFY_SKIP_AUDIT:-0}" != "1" ]; then
  step "audit"
  PROD_JSON=$(npm audit --omit=dev --json 2>/dev/null || true)
  # Counts UNACCEPTED high/critical advisories. Advisory IDs in ACCEPTED are
  # documented exceptions — they are reported but do not fail the gate. Any
  # parse/network failure yields "ERR" and FAILS THE GATE (fail-closed: a
  # broken audit must never silently pass; use VERIFY_SKIP_AUDIT=1 only after
  # a manual report review).
  PROD_COUNT=$(printf '%s' "$PROD_JSON" | node -e '
    let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{
      try{
        const j=JSON.parse(s);
        if(!j.vulnerabilities || !j.metadata) throw new Error("no audit data");
        // ── accepted advisories (documented exceptions) ─────────────────
        // GHSA-mrhx-c7xc-m3w5 — zod <4.6.6, memory exhaustion validating
        // oversized constrained collections. No zod 3.x fix exists, and the
        // @jimp/* plugin tree pins zod ^3.23.8, so a zod 4 migration would
        // leave their nested copy flagged regardless. EchoFox only validates
        // its own operator-controlled config file with zod — accepted until
        // jimp ships a zod-4-compatible release.
        const ACCEPTED=new Set(["GHSA-mrhx-c7xc-m3w5"]);
        const seen=new Set();
        for(const pkg of Object.values(j.vulnerabilities)){
          for(const via of pkg.via||[]){
            if(typeof via!=="object") continue;
            if(via.severity!=="high" && via.severity!=="critical") continue;
            const id=String(via.url||"").split("/").pop();
            if(ACCEPTED.has(id)) continue;
            seen.add(id||via.title||"unknown");
          }
        }
        console.log(String(seen.size));
      }catch(e){console.log("ERR");}});')
  if [ "$PROD_COUNT" = "0" ]; then
    ok
    printf '%s' "$PROD_JSON" | node -e '
      let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{
        try{const m=JSON.parse(s).metadata.vulnerabilities;
          const n=(m.total||0);
          if(n>0)console.log(`    (prod deps: ${n} lower-severity finding(s) — reviewed below if any)`);}
        catch{}});'
  elif [ "$PROD_COUNT" = "ERR" ]; then
    fail
    echo "  ${RED}could not parse npm audit output (network failure or npm error) — failing closed.${OFF}"
    echo "  Re-run with network access; or, only after a manual audit review:"
    echo "    VERIFY_SKIP_AUDIT=1 bash scripts/verify.sh"
  else
    fail
    echo "  ${RED}$PROD_COUNT unaccepted high/critical advisory(ies) in PRODUCTION dependencies:${OFF}"
    npm audit --omit=dev 2>&1 | sed 's/^/    /'
    echo "  Fix path: npm audit --omit=dev  → review, upgrade affected deps,"
    echo "  regenerate lockfile (npm install --package-lock-only), re-run verify."
  fi
  # Informational: full audit incl. dev deps (vitepress/vite dev-tooling noise
  # currently has no upstream fix — do not fail the push for it).
  echo "  ${DIM}dev-deps audit (informational):$(npm audit 2>&1 | grep -E '^[0-9]+ vulnerabilities|found 0' | tail -1 | tr -d '.')${OFF}"
else
  skip "audit"
fi

# ═════════════════════════════════════════════════════════════════════════════
# 10. secret scan of the outgoing diff
# ═════════════════════════════════════════════════════════════════════════════
step "secrets"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # Added/changed lines vs HEAD (staged + unstaged); falls back to scanning
  # the last commit when the worktree is clean.
  DIFF_ADDED=$( { git diff HEAD --unified=0 -- . ':!package-lock.json' ':!dashboard/package-lock.json';
                  git diff --cached --unified=0 -- . ':!package-lock.json' ':!dashboard/package-lock.json'; } 2>/dev/null \
                | grep -E '^\+' | grep -v '^+++' || true)
  [ -z "$DIFF_ADDED" ] && DIFF_ADDED=$(git show HEAD --unified=0 --format= -- . ':!package-lock.json' ':!dashboard/package-lock.json' 2>/dev/null | grep -E '^\+' | grep -v '^+++' || true)

  HITS=$(printf '%s\n' "$DIFF_ADDED" | grep -EnE \
    "AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}" \
    || true)
  if [ -n "$HITS" ]; then
    fail
    echo "  ${RED}Possible secret(s) in the outgoing diff — verify before pushing:${OFF}"
    printf '%s\n' "$HITS" | head -10 | sed 's/^/    /'
    echo "  If genuine: DO NOT COMMIT. Rotate the credential, then remove it and"
    echo "  rewrite the commit (git reset --soft HEAD~1, edit, re-commit)."
  else
    ok
  fi
else
  skip "secrets (not a git repo)"
fi

# ═════════════════════════════════════════════════════════════════════════════
# 11. git hygiene — whitespace, conflict markers, tracked sensitive files
# ═════════════════════════════════════════════════════════════════════════════
step "git-hygiene"
HYG_FAIL=0
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  WS=$(git diff --check HEAD 2>&1; git diff --cached --check 2>&1) || HYG_FAIL=1
  if [ -n "$(printf '%s' "$WS" | tr -d '[:space:]')" ]; then HYG_FAIL=1; echo "    whitespace/conflict issues: $WS" | head -6; fi

  CONFLICT=$(git diff HEAD --unified=0 2>/dev/null | grep -cE '^\+.{0,1}(<{7}|={7}$|>{7})' || true)
  [ "${CONFLICT:-0}" -gt 0 ] && { HYG_FAIL=1; echo "    conflict markers present in working diff"; }

  SENSITIVE=$(git ls-files 2>/dev/null | grep -iE '(^|/)\.env$|\.env\.[^.]+$|(^|/)creds\.json$|(^|/)auth_info|\.pem$|(^|/)id_rsa|(^|/)session\.json$' | grep -v '.env.example' || true)
  if [ -n "$SENSITIVE" ]; then HYG_FAIL=1; echo "    sensitive files tracked: $SENSITIVE"; fi
fi
[ "$HYG_FAIL" = "0" ] && ok || fail

# ═════════════════════════════════════════════════════════════════════════════
# 12. summary
# ═════════════════════════════════════════════════════════════════════════════
echo
echo "──────────────────────────────────────────────────────────────"
FAILED=0; SKIPPED=0
for r in "${RESULTS[@]}"; do
  status="${r%%|*}"; name="${r#*|}"
  if [ "$status" = "FAIL" ]; then
    FAILED=$((FAILED+1)); printf '  %s✗ FAIL%s  %s\n' "$RED" "$OFF" "$name"
  elif [ "$status" = "skip" ]; then
    SKIPPED=$((SKIPPED+1)); printf '  %s- skip%s  %s\n' "$YELLOW" "$OFF" "$name"
  else
    printf '  %s✓ pass%s  %s\n' "$GREEN" "$OFF" "$name"
  fi
done
echo "──────────────────────────────────────────────────────────────"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "${BOLD}Outgoing changes (review before committing/pushing):${OFF}"
  git status --short | head -30
  echo
  git diff --stat HEAD | tail -5 2>/dev/null
fi

if [ "$FAILED" -gt 0 ]; then
  echo
  echo "${RED}${BOLD}$FAILED step(s) failed.${OFF} Fix the issues above, then re-run ${BOLD}npm run verify${OFF}."
  echo "Do not push with failing local checks — CI runs the same gates and will fail."
  exit 1
fi
echo
echo "${GREEN}${BOLD}All local checks passed.${OFF} (skipped: $SKIPPED)"
echo "Next: review the diff above, then:"
echo "  git add -A && git commit -m \"<message>\" && git push"
echo "  gh run watch   # or: gh run list --limit 5   # watch CI on GitHub"
exit 0
