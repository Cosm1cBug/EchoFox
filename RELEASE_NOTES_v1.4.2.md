# EchoFox v1.4.2 — Self-healing Signal protocol 🩹🔐

A small but high-impact patch release. EchoFox now automatically recovers
from the most common WhatsApp decryption errors (`Bad MAC`, `No session
found to decrypt message`) without operator intervention, and stops
spamming your logs with them.

## What's the actual problem?

Every WhatsApp conversation maintains a **Signal session** per sender
device — a chain of cryptographic ratchets that step forward on every
message. When a sender's device state drifts out of sync with your bot's
copy of the session (they reinstalled WhatsApp, paired a new device,
rotated keys, etc.), decryption fails with:

```
ERROR: failed to decrypt message
  err.message: 'Bad MAC'  -or-  'No session found to decrypt message'
```

Before v1.4.2:
- These errors flooded the log stream at ERROR level
- Baileys would *eventually* recover on its own (often within hours)
- One stuck sender = continuous noise until they sent another message
  or rotated keys

After v1.4.2:
- Errors are tracked silently (logged at DEBUG, not ERROR)
- After **3 consecutive failures from the same sender within 5 minutes**,
  EchoFox automatically resets that sender's session
- Next inbound message from them triggers a fresh prekey exchange →
  decryption resumes
- One WARN log per recovery: `🩹 signal-health: session reset for sender`

## How it works

```
  Incoming message from JID X arrives
              │
              ▼
  Baileys decryption fails (Bad MAC / No session)
              │
              ▼
  signalHealth.record() ─── counts failure for X
              │
              ├── count < 3?  →  log at DEBUG, wait for next
              │
              ├── count >= 3 within 5min?
              │     │
              │     ├── X on cooldown (recovered <30min ago)?
              │     │     → drop quietly (no thrashing)
              │     │
              │     └── otherwise:
              │           ├── call sock.signalRepository.deleteSession(X)
              │           ├── reset failure counter for X
              │           ├── log at WARN: "🩹 session reset for sender"
              │           └── mark X on 30min cooldown
```

## Will WhatsApp ban me for this?

**No.** `signalRepository.deleteSession()` is a **local filesystem operation
only** — no WhatsApp servers are contacted, no traffic crosses the wire.
Recovery is driven entirely by the next inbound message triggering
Signal's standard prekey-fetch flow (the same flow that fires millions of
times daily for every reinstall on the platform).

With the conservative 3-failure / 5-minute threshold and 30-minute per-JID
cooldown, recoveries are capped at **~2/hour/sender** even in adversarial
conditions. That's far below anything WhatsApp could plausibly flag.

## What you can monitor now

### Logs

Old (v1.4.1 and earlier):
```
[12:34:56] ERROR: failed to decrypt message  ← every single failure
[12:34:57] ERROR: failed to decrypt message
[12:34:58] ERROR: failed to decrypt message
[12:34:59] ERROR: failed to decrypt message  ← endlessly
```

New (v1.4.2):
```
[12:34:59] WARN: 🩹 signal-health: session reset for sender after consecutive decryption failures
              jid: '262516991086663@lid', failuresInWindow: 3
```

That's it. The individual failures are still tracked (counters bump), just
not flooded to ERROR level.

### Grafana

Re-provision `docker/grafana/dashboards/echofox-overview.json` and you'll
see a new row at the bottom: **Signal Protocol Health (v1.4.2+)**

4 new panels:
- Stat: **Decryption failures (24h)** — total raw failure events
- Stat: **Auto session-recoveries (24h)** — total `deleteSession()` calls
- Stat: **Recovery efficiency** — recoveries / failures (a useful ratio:
  values around 0.05–0.2 are healthy; closer to 1.0 means failures cluster
  on a small number of senders and recovery is working hard)
- Timeseries: **Signal protocol activity (5m rate)** — failures/sec +
  recoveries/sec on one chart, time-aligned

### Metrics endpoints

Two new Prometheus counters scrapable at `:3001/metrics`:
- `echofox_signal_decryption_failures_total`
- `echofox_signal_session_recoveries_total`

## Also fixed in this release (CI/CD)

Three real CI bugs that surfaced when v1.4.1 went through the release
workflows:

1. **`npm test` was using a glob (`src/**/*.test.js`) that Node.js
   doesn't expand**, and bash on Ubuntu CI doesn't have `globstar`
   enabled by default. The test job kept failing with
   `Could not find 'src/**/*.test.js'`. Replaced with a pure-Node
   recursive walker at `scripts/run-tests.js` — works on every shell
   and Node version we support, auto-discovers new test files.

2. **TruffleHog secret scanning failed on every push to `main`**
   because the old config passed `base: default_branch` +
   `head: github.ref` → both resolved to `main` → TruffleHog bailed
   with `base == head`. Split the workflow into three event paths:
   `pull_request` (diff PR head vs base), `push` (diff the pushed
   commit range via `github.event.before`), `workflow_dispatch` /
   first-push (full repo scan).

3. **Release + npm-publish + CI workflows** all called `npm test`,
   so fix #1 transitively fixes all three.

These were pre-existing bugs in the v1.4.0/v1.4.1 workflows; we just
caught them now that `release.yml` + `npm-publish.yml` actually gate
on test success.

## Upgrading

Drop-in upgrade from v1.4.1:

```bash
git pull && npm install
```

…or with Docker:

```bash
docker pull cosm1cbug/echofox:1.4.2
```

…or via npm:

```bash
npm install echofox@1.4.2
```

No schema changes, no config changes, no env-var changes. The thresholds
(3 failures / 5min window / 30min cooldown) are constants for now — if
you need to tune them, they're at the top of `src/services/signalHealth.js`.

## Tests

```
$ npm test
# tests 147
# pass 147
# fail 0
```

10 new tests in `src/__tests__/integration/signal-health.test.js` cover:
- Pattern recognition for all 5 known error messages
- JID normalisation (`:device` tag stripping for `@lid` and `@s.whatsapp.net`)
- Per-JID failure counting
- Threshold trigger at exactly 3
- Cooldown enforcement (no double-recovery within 30min)
- Cross-JID isolation (counts don't bleed between senders)
- Mixed error types (Bad MAC + No session within same window still trips)
- Graceful degradation when `signalRepository` is unavailable
- `snapshot()` exposes tracking state for diagnostics

All 137 v1.4.1 tests still pass; this is a pure additive change.

— EchoFox v1.4.2 · 2026-06-12
