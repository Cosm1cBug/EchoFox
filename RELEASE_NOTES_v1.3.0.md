# EchoFox v1.3.0 — Telegram log bridge + persistent rate-limits 📡🦊

v1.3.0 takes two follow-ups from v1.2.0 across the finish line. First,
EchoFox can now **mirror its WhatsApp log channels to Telegram** —
zero dependencies, outbound-only, per-channel routing, instant flush
on errors. Second, the AI rate-limit counters that previously lived
only in memory **now survive restarts** by being persisted to your
chosen store flavour.

## TL;DR

- **Telegram log bridge** — read-only, raw HTTPS to api.telegram.org.
  Map any WhatsApp log channel (syslogs / botLogs / errLogs / …) to a
  Telegram chat or `@channel`. 2-second batch for chatty logs;
  instant flush for `error`/`fatal`.
- **Persistent AI rate-limits** — 30-per-hour user cap and
  100-per-day chat cap now backed by sqlite / postgres / mongo or
  redis. Bouncing the bot no longer resets a spammer's quota.
- **Zero new dependencies.** Telegram is just HTTPS over the
  existing `axiosWithBreaker`.
- **Discord dropped** from the roadmap. WhatsApp + Telegram is it.

## Quick start — Telegram

1. Talk to **@BotFather** on Telegram, create a bot, copy the token.
2. Add the bot to each chat/channel you want to receive logs in,
   **as an admin** (so it can post).
3. Edit `src/config.js`:

   ```js
   telegram: {
     enabled: true,
     botToken: process.env.TELEGRAM_BOT_TOKEN || 'TOKEN_FROM_BOTFATHER',
     routing: {
       syslogs: '@echofox_sys',          // public channel handle
       botLogs: '-1001234567890',        // private group numeric id
       errLogs: '@echofox_err',
       // leave others as '' to disable
     },
     parseMode: 'HTML',
     batchMs:   2000,                    // errors flush instantly
     maxChunkChars: 3800,
   },
   ```

4. Restart. From now on, anything EchoFox sends to a configured
   WhatsApp log channel **also lands in the mapped Telegram chat**.

## What's mirrored to Telegram today

| Source                                               | Channel key | Level   |
| ---------------------------------------------------- | ----------- | ------- |
| Command crash stack-traces (from `commandRunner.js`) | `errLogs`   | `error` |
| Alert engine — alert triggered                       | `errLogs`   | `error` |
| Alert engine — alert cleared                         | `errLogs`   | `info`  |

This list will grow in v1.3.x as more WA log producers get tapped.

## Persistent rate-limits at a glance

Before v1.3.0:

> User exceeds 30/hour → bot blocks → admin restarts the bot →
> **user immediately gets 30 more replies**.

After v1.3.0:

> User exceeds 30/hour → bot blocks → admin restarts the bot →
> **counter survives, user is still blocked until the hour boundary**.

### What's persisted

Two store tables/collections (per flavour):

- `ai_rate_user (user_jid, hour_bucket, count, expires_at)`
- `ai_rate_chat (chat_jid, day_bucket, count, expires_at)`

### Behaviour by store

| Store    | Persistence      | Auto-expiry                           |
| -------- | ---------------- | ------------------------------------- |
| sqlite   | ✅ Migration 006 | Lazy via `pruneAiRate()` every 10 min |
| postgres | ✅ Migration 006 | Lazy via `pruneAiRate()` every 10 min |
| mongo    | ✅ Migration 006 | Native TTL index on `expires_at`      |
| redis    | ✅ Lazy keys     | Native `EXPIREAT` per bucket          |

If you're running a store flavour without migration 006 applied for
some reason, the router **transparently falls back** to in-memory
counters so the bot keeps working.

## What was considered and rejected

- **Discord bridge.** Out of scope; effort goes to Telegram + WA.
- **Incremental WhatsApp streaming UX for AI replies.** Editing
  the same WA message many times per generation risks Baileys-level
  bans. The v1.2.0 "composing" presence indicator stays. If you
  want to see partial AI output, watch the `composing` icon — the
  full reply lands as one clean message when done.

## Upgrading from v1.2.x

1. `git pull`.
2. `npm install` (no new dependencies; nothing actually changes
   in `node_modules` for this release).
3. Restart — migrations 005 (if not yet applied) and 006 run on
   boot. Both are additive and idempotent.
4. Optionally fill in `config.telegram.*` to enable the mirror.
   Existing AI / general behaviour is unchanged if you skip this.

## Tests

```
$ npm test
# tests 130
# pass 130
# fail 0
```

16 new tests in this release:

- `__tests__/integration/telegram.test.js` (12): routing, batching,
  immediate-flush on error, chunking, retry, HTML render, drain.
- `__tests__/integration/ai-rate-persist.test.js` (4): counter
  survives sqlite re-open, router uses store when available,
  router falls back to in-memory when store lacks methods,
  `pruneAiRate` respects `expires_at`.

All 114 v1.2.0 tests still pass; the persistent rate-limit refactor
is fully backward-compatible.

— EchoFox v1.3.0 · 2026-06-11
