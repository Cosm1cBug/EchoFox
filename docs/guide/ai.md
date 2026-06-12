# AI service 

EchoFox can act as a multi-provider LLM chatbot directly inside WhatsApp.
This page is the user-facing reference for what's enabled by default,
what you have to flip on, and how to keep costs under control.

## TL;DR

- Four providers: **OpenAI**, **Google Gemini**, **Anthropic Claude**,
  and **local Ollama**. Pick a default in config; per-chat overrides
  are persisted.
- **12 tools** (intel-focused): VirusTotal lookups, AlienVault OTX,
  GitHub releases/advisories, Wikipedia, an SSRF-guarded `fetch_url`,
  and five read-only WhatsApp store queries.
- **Opt-in per chat** — explicit `.ai on` toggle, or mention the bot
  by name. No surprise replies anywhere.
- **20-turn rolling memory** per chat (10 user + 10 assistant).
- **Hard daily cost cap** (default `$5/day`); rate limits **30/user/hr**
  and **100/chat/day**. v1.3.0 made those counters persist across
  restarts.
- **v1.4.0**: built-in alert fires at `80%` of daily cap, and the
  full pipeline now emits Prometheus metrics + Grafana panels.

## Enable AI

Edit `src/config.js`:

```js
ai: {
  enabled:          true,
  defaultProvider:  'openai',          // openai | gemini | anthropic | local
  model:            'gpt-4o-mini',
  costCapPerDayUsd: 5,
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
  },
},
```

Then restart. By default no chats are opted-in; users explicitly
enable per-chat with `.ai on`.

## User commands (prefix `.`)

| Command | Effect |
|---|---|
| `.ai`, `.ai status` | Show status + today's spend vs cap |
| `.ai on` / `.ai off` | Per-chat opt-in toggle |
| `.ai clear` | Forget conversation memory for this chat |
| `.ai persona <p>` | `threat-intel` \| `general` \| `custom` |
| `.ai provider <p>` | `openai` \| `gemini` \| `anthropic` \| `local` |
| `.ai model <name>` | Override the default model |

## Admin commands (prefix `$`, name `ai-admin`)

| Command | Effect |
|---|---|
| `$ai-admin stats [days]` | Daily token + cost summary |
| `$ai-admin chats` | List opted-in chats |
| `$ai-admin limit get / set <usd>` | Read or live-edit cost cap |
| `$ai-admin enable / disable` | Flip `config.ai.enabled` in memory |

## Personas

- **`threat-intel`** (default) — security-focused. Cites IoCs / CVEs /
  vendor verdicts and avoids generic advice.
- **`general`** — friendly assistant, no security slant.
- **`custom`** — uses the string in `config.ai.customPersona`.

## Tools (12 by default)

| Tool | Needs API key? | Returns |
|---|---|---|
| `get_blocklist` | no | current blocked JIDs (sample) |
| `get_presence_in_chat` | no | recent presence states per JID |
| `get_labels_for_chat` | no | WA Business labels on a target |
| `list_newsletters` | no | newsletters known to the bot |
| `get_recent_messages` | no | last N stored messages in a chat |
| `check_virustotal` | yes (`config.apis.virustotal.apiKey`) | VT verdict stats + reputation |
| `search_alienvault` | yes (`config.apis.alienvault.apiKey`) | OTX pulse summary |
| `latest_hackernews` | no | latest THN RSS items |
| `github_releases` | optional (token raises rate limit) | latest releases for repo |
| `github_advisories` | optional | GHSA matches for a query |
| `wiki_lookup` | no | Wikipedia summary (en) |
| `fetch_url` | no | GET ≤200 KB; **SSRF-guarded** |

Tools requiring a key are **automatically hidden** from the model
when the key is missing. The whitelist is configurable via
`config.ai.toolWhitelist`.

## Cost control

The pricing table lives in `src/services/ai/costTracker.js`:

| Model | Prompt $/1M | Completion $/1M |
|---|---|---|
| `gpt-4o-mini` | 0.15 | 0.60 |
| `gpt-4o` | 2.50 | 10.00 |
| `gemini-2.0-flash` | 0.10 | 0.40 |
| `claude-3-5-haiku-latest` | 0.80 | 4.00 |
| `claude-3-5-sonnet-latest` | 3.00 | 15.00 |
| _Local (Ollama)_ | **0** | **0** |
| _unknown model_ | falls back to `gpt-4o-mini` rates |

`config.ai.costCapPerDayUsd` is a hard stop — once today's spend ≥ cap,
`router.shouldRespond()` returns `respond: false, reason: 'cost_cap'`
and the LLM is never called. Reset at UTC midnight.

**v1.4.0**: when daily spend reaches `config.alerts.rules.aiCostPct.threshold`
(default `0.80` = 80%), the alert engine fires once (with cooldown)
to WhatsApp `errLogs` and the Telegram mirror. See
[CI/CD &amp; ops](/deploy/ci-cd) for the Grafana panel.

## Security

- **SSRF guard** in `fetch_url` blocks RFC 1918 / link-local / loopback.
- **API keys never leave the bot.** Dashboard `/api/ai/config`
  returns booleans, never the secrets themselves.
- **Per-chat opt-in** — no surprise replies in chats that didn't ask.
- **Cost cap is a hard stop** — the LLM is never called when the cap
  has been hit; the bot drops quietly with a `cost_cap` log.

## Known limitations

- Streaming is single-message ("composing" presence + one final
  reply), not incremental WA message edits — incremental editing
  was explicitly rejected in v1.3.0 because of ban risk.
- The `provider/model` override stored per chat is honoured by
  `ai.chat()` but not currently surfaced in the dashboard UI.
