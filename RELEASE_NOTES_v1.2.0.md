# EchoFox v1.2.0 — AI service with intel-focused tool calling 🤖🦊

EchoFox can now hold a conversation. v1.2.0 ships a full multi-provider
LLM service — OpenAI, Gemini, Anthropic, or a local Ollama box — with
12 intel-focused tools, per-chat opt-in, a 20-turn rolling memory, and
a hard daily $ cost cap. It's wired straight into the message pipeline
so any non-command text in an opted-in chat becomes a reply.

## TL;DR

- **4 providers, one facade** — `openai` / `gemini` / `anthropic` /
  `local` (Ollama). Switch per-chat with `.ai provider <name>`.
- **12 tools** (intel-focused): `check_virustotal`, `search_alienvault`,
  `github_advisories`, `github_releases`, `latest_hackernews`,
  `wiki_lookup`, `fetch_url` (SSRF-guarded), and 5 read-only store
  queries (`get_blocklist`, `get_presence_in_chat`,
  `get_labels_for_chat`, `list_newsletters`, `get_recent_messages`).
- **`threat-intel` persona** by default — answers cite IoCs / CVEs /
  vendor verdicts, not generic advice. Swap to `general` or define
  your own `custom` persona.
- **20-turn rolling memory** per chat, persisted in the store. Wipe
  with `.ai clear`.
- **Opt-in per chat** — explicitly enable with `.ai on` (DMs included),
  or just mention the bot by name (regex configurable).
- **Loose rate limits** — 30 generations / user / hour, 100 / chat /
  day, plus a global `\$5/day` cost cap (live-editable from `$ai-admin
limit set`).
- **Composing presence** while generating (no streamed edits — one
  final clean reply).
- **New dashboard tab "AI"** — config card, today-vs-cap progress bar,
  per-day token/cost rollup, opted-in chats list.

## Quick start

```js
// src/config.js
ai: {
  enabled:          true,
  defaultProvider:  'openai',
  model:            'gpt-4o-mini',
  costCapPerDayUsd: 5,
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
  },
},
```

Then in any chat:

```
.ai on            # opt this chat in
hey echofox, what's the latest on log4j
```

The bot will reply by chaining `github_advisories` + `latest_hackernews`

- `wiki_lookup` if needed, citing sources, all under your daily cap.

## Commands at a glance

User (`.` prefix):

| Command              | Effect                                         |
| -------------------- | ---------------------------------------------- |
| `.ai`, `.ai status`  | Show status (incl. today's spend vs cap)       |
| `.ai on` / `.ai off` | Per-chat opt-in toggle                         |
| `.ai clear`          | Forget conversation memory for this chat       |
| `.ai persona <p>`    | `threat-intel` \| `general` \| `custom`        |
| `.ai provider <p>`   | `openai` \| `gemini` \| `anthropic` \| `local` |
| `.ai model <name>`   | Override the default model                     |

Admin (`$` prefix; command name `ai-admin`, alias `aiadmin`):

| Command                        | Effect                                 |
| ------------------------------ | -------------------------------------- |
| `$ai-admin stats [days]`       | Daily token + cost summary (default 7) |
| `$ai-admin chats`              | List opted-in chats                    |
| `$ai-admin limit get`          | Show cap + today's spend               |
| `$ai-admin limit set <usd>`    | Live-override cap (until restart)      |
| `$ai-admin enable` / `disable` | Flip `config.ai.enabled`               |

## What's persisted

Three new tables/collections (per store flavour):

- `ai_conversations` — append-only turn log (user / assistant /
  tool), with model + token attribution, indexed by chat + ts.
- `ai_usage_daily` — `(day, provider, model)` keyed rollup of
  prompt tokens, completion tokens, USD cost, and call count.
- `ai_chat_opt_in` — per-chat enabled flag + overrides
  (persona / provider / model), updated_at.

Migration 005 is **additive and idempotent** for every store flavour.

## Pricing table (USD per 1M tokens)

Built into `src/services/ai/costTracker.js`. Sample:

| Model                      | Prompt                            | Completion |
| -------------------------- | --------------------------------- | ---------- |
| `gpt-4o-mini`              | $0.15                             | $0.60      |
| `gpt-4o`                   | $2.50                             | $10.00     |
| `gemini-2.0-flash`         | $0.10                             | $0.40      |
| `claude-3-5-haiku-latest`  | $0.80                             | $4.00      |
| `claude-3-5-sonnet-latest` | $3.00                             | $15.00     |
| **Local (Ollama)**         | **$0**                            | **$0**     |
| _unknown model_            | falls back to `gpt-4o-mini` rates |

A typical `.ai status` in a chat that has used `gpt-4o-mini` once
with one tool round costs about **$0.00007** (320 prompt + 40
completion tokens).

## Security model

- **SSRF guard** in `fetch_url` blocks RFC 1918 / link-local / loopback /
  `.local` / `localhost`. The LLM cannot exfiltrate intranet data
  by asking the bot to "go fetch http://10.0.0.1/...".
- **API keys never leave the bot** — `/api/ai/config` returns only
  a boolean per provider indicating whether one is configured.
- **Tools requiring a key are auto-hidden** from the model spec when
  the key is missing — VirusTotal / AlienVault won't appear in the
  function-call menu until you set the key.
- **Per-chat opt-in** — bots aren't surprise-replying in chats nobody
  invited them to. `optInDefault: 'off'` is the shipped default.
- **Cost cap is a hard stop** — once today's spend ≥ cap, `router.shouldRespond()`
  returns `respond: false, reason: 'cost_cap'` and the LLM is never
  called. Reset at UTC midnight.

## Known limitations

- AI streaming is single-message ("composing" presence + one final
  reply), not incremental WhatsApp message edits.
- Rate-limit counters are in-memory only; bouncing the process
  resets them. Persistence is a v1.3.x candidate.
- The 2 transitive CVEs in `@whiskeysockets/baileys`'s bundled
  `link-preview-js` remain upstream issues — not actionable here.

## Upgrading from v1.1.x

1. `git pull` and `npm install` (4 new SDKs land as transitive deps).
2. Restart — migration 005 runs on boot, adds 3 tables (idempotent).
3. Set `config.ai.enabled = true` + at least one provider API key
   to start using AI features. Nothing else changes if you skip this.

## Tests

```
$ npm test
# tests 114
# pass 114
# fail 0
```

11 new tests covering router decisions, tool-call loop, memory
persistence, cost aggregation, rate limiting, SSRF guard, toolWhitelist
filtering, and persona resolution. All 101 v1.1.x tests still pass.

— EchoFox v1.2.0 · 2026-06-11
