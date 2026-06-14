# Soak testing

EchoFox ships with three M6 scripts for long-running stability validation.

## Quick reference

| Script                     | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `scripts/heap-snapshot.js` | One-shot v8 heap snapshot to disk                |
| `scripts/heap-diff.js`     | Compare two snapshots, report class-level growth |
| `scripts/soak.js`          | Synthetic load harness with periodic sampling    |

## In-process leak detector

Always-on runtime watchdog enabled via `config.runtime.leakDetection`:

```js
runtime: {
  // ...
  leakDetection: {
    enabled:                true,
    sampleIntervalMs:       600000,    // 10 min
    windowSize:             144,        // 24h rolling
    growthThresholdPercent: 30,         // alert at 30% growth
  },
},
```

Mechanism: every `sampleIntervalMs` it records the heap-used MB into a
rolling window of `windowSize` samples. If the MIN heap in the
window's later half exceeds the MAX heap in the earlier half by
`growthThresholdPercent`, it logs a warn + bumps
`leak_alerts_total` and sets the gauge `leak_suspected = 1`.

This complements `memoryGuard` (which catches **instantaneous** heap
pressure for OOM protection); leak detection catches **slow growth**
over hours.

## Heap snapshots

Capture a snapshot at any moment:

```bash
node scripts/heap-snapshot.js
# → ./snapshots/heap-2026-06-09T14-30-00.heapsnapshot
```

Or write to a specific path:

```bash
node scripts/heap-snapshot.js --out=./before.heapsnapshot
```

Open the resulting file in Chrome DevTools (chrome://inspect →
Memory → Load).

## Heap diff

Compare two snapshots to find class-level retention growth:

```bash
node scripts/heap-diff.js ./before.heapsnapshot ./after.heapsnapshot
```

Output:

```text
=== Top 30 class deltas (by abs retained-size change) ===
CLASS                                         +Δ count        +Δ size      pct
-------------------------------------------------------------------------------
object:Promise                                     +423      +12.8 KB    42.1%
string:                                            +156       +8.4 KB    18.2%
...
Total heap delta: 0.34 MB
```

If the total exceeds 50 MB, you get a warning to review suspect retainers.

## Synthetic soak

For a self-contained leak check WITHOUT a real WhatsApp connection:

```bash
node scripts/soak.js --durationMin=60 --rate=10 --snapshot=15
```

Options:

- `--durationMin` — how long to run (default 60)
- `--rate` — synthetic messages per minute (default 10)
- `--snapshot` — take a heap snapshot every N minutes (default 0 = off)
- `--out` — output directory (default `./soak-out`)

The harness uses an in-memory SQLite + mock socket, fires synthetic
`.ping` messages, samples heap + RSS every minute, and writes:

- `<out>/report.json` — per-minute samples
- `<out>/summary.txt` — verdict (PASSED / WARN / FAILED)
- `<out>/heap-T<N>.heapsnapshot` — periodic snapshots (if requested)

### Recommended soak profiles

| Profile       | Command                                                           |
| ------------- | ----------------------------------------------------------------- |
| Smoke (5 min) | `node scripts/soak.js --durationMin=5 --rate=20`                  |
| Short (1 h)   | `node scripts/soak.js --durationMin=60 --rate=10 --snapshot=15`   |
| Medium (8 h)  | `node scripts/soak.js --durationMin=480 --rate=5 --snapshot=60`   |
| Long (24 h)   | `node scripts/soak.js --durationMin=1440 --rate=2 --snapshot=180` |

## Production soak

For real-world soak on a deployed bot:

1. Set `runtime.leakDetection.enabled: true` in `config.js` (default)
2. Configure alert channel: `config.alerts.notifyChannel`
3. Let it run with normal user traffic for ≥48 hours
4. Watch the dashboard's Metrics tab for the `leak_suspected` gauge
5. If the leak alert fires, take a heap snapshot, restart, take another,
   and diff them

## Verdict thresholds

Synthetic soak verdict (in `scripts/soak.js`):

- Heap growth ≤ 20 MB → **✓ PASSED**
- Heap growth 20-50 MB → **⚠️ WARN** (investigate)
- Heap growth > 50 MB → **❌ FAILED** (likely leak)

These thresholds assume a baseline bot with no long-lived caches.
Tune per your workload.
