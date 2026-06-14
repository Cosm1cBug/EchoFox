# Telegram log bridge

EchoFox can mirror its WhatsApp log channels to Telegram. The bridge is
**outbound-only** — the bot never polls Telegram and ignores any
messages sent to it on the Telegram side.

## TL;DR

- Zero new dependencies — raw HTTPS to `api.telegram.org` over
  the existing `axiosWithBreaker` (circuit-breaker + retry).
- Per-channel routing: each WA log channel (`syslogs` / `botLogs` /
  `errLogs` / …) maps to its own Telegram chat or `@channel`.
- 2-second batch by default for chatty info-level logs.
- **Error / fatal** levels flush **immediately**, bypassing the
  batch timer.
- HTML format by default (`<b>WARN</b> [src]`) with full HTML
  escape on payload text.
- v1.4.0 adds a built-in alert that fires when Telegram's own
  send-failure rate exceeds the configured threshold.

## Setup (3 minutes)

1. Open **@BotFather** on Telegram, send `/newbot`, copy the token.
2. Add your bot as **admin** to each chat/channel you want logs in
   (otherwise it can't post).
3. Edit `src/config.js`:

   ```js
   telegram: {
     enabled:   true,
     botToken:  process.env.TELEGRAM_BOT_TOKEN || 'TOKEN_FROM_BOTFATHER',
     routing: {
       syslogs: '@echofox_sys',          // public channel handle
       botLogs: '-1001234567890',        // private group numeric id
       errLogs: '@echofox_err',
       // empty string disables that channel's mirror
       userLogs: '', groupUpdates: '', callLogs: '', movGroup: '',
     },
     parseMode:     'HTML',              // HTML | MarkdownV2 | plain
     batchMs:       2000,                // errors flush instantly
     maxChunkChars: 3800,                // Telegram cap is 4096
   },
   ```

4. Restart. Anything the bot sends to a mapped WA log channel now
   also lands in the matching Telegram chat.

## Channel keys

The 7 supported keys match `config.channels.*`:

| Key            | Typical use                                             |
| -------------- | ------------------------------------------------------- |
| `syslogs`      | startup / shutdown / reconnect / heartbeat              |
| `botLogs`      | message edit / delete / reaction notifications          |
| `userLogs`     | user-action audit trail                                 |
| `groupUpdates` | participant / metadata changes                          |
| `callLogs`     | incoming-call notifications                             |
| `errLogs`      | command crashes + alertEngine alerts (default for both) |
| `movGroup`     | bot-was-removed-from-group notifications                |

## What's mirrored today

| Source                                                       | Channel   | Level   |
| ------------------------------------------------------------ | --------- | ------- |
| Command crash stack-traces (`commandRunner.js`)              | `errLogs` | `error` |
| Alert engine — alert triggered (incl. v1.4.0 built-in rules) | `errLogs` | `error` |
| Alert engine — alert cleared                                 | `errLogs` | `info`  |

More producers will be tapped in future minor releases.

## Message format

Default `parseMode: 'HTML'` produces, per entry:

```
❌ <b>ERROR</b> <code>2026-06-11 12:34:56.789</code> [cmd:ping]
Command crashed: ping (cat:misc)
From 1234567890@s.whatsapp.net in 123-456@g.us

TypeError: Cannot read property 'x' of undefined
    at ...
```

Switch to `'plain'` for no formatting at all, or `'MarkdownV2'` (be
warned: Telegram's MarkdownV2 has many footgun characters that have
to be escaped — `parseMode: 'HTML'` is recommended).

## Batching behaviour

- `info` / `debug` / `warn` entries are buffered for `batchMs` (default
  2000ms) and sent as a single Telegram message joined by blank lines.
- `error` and `fatal` entries flush **immediately** — any pending batch
  timer is cancelled and the existing buffer is sent right away.
- If the rendered body exceeds `maxChunkChars` (default 3800), it's
  split at newline boundaries into multiple Telegram messages.
- A Telegram `retry_after` response is honoured **once** (max 60s);
  subsequent failures log quietly so the bridge can never crash
  the producer.

## Reliability gates (v1.4.0)

`config.alerts.rules.telegramFailureRate` (defaults: `threshold: 0.20`,
`minSends: 10`, `cooldownMinutes: 30`) — fires when, over the alert
window, the rate of failed Telegram sends exceeds the threshold AND
the bridge has actually sent at least `minSends` messages (gate
against false positives from low traffic).

See [CI/CD &amp; ops](/deploy/ci-cd) for the matching Grafana panel.

## Security

- **Strictly outbound.** No bot polling, no webhook, no inbound
  command surface from Telegram.
- The bot token is never exposed via any dashboard API route.
- HTML escape is applied to **all** payload text before sending.

## Known limitations

- **Text only** — images, audio, documents in WA log channels are
  not forwarded. The bridge sends `sendMessage` only.
- Bouncing the process does not flush in-flight batches (default 2s
  window). Call `telegram.flushAll()` from your shutdown hook if you
  want guaranteed delivery on graceful exit.
