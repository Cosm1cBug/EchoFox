# AI service

EchoFox can act as a multi-provider LLM chatbot directly inside WhatsApp.
This page is the user-facing reference for what's enabled by default,
what you have to flip on, and how to keep costs under control. The current hardening is unreleased; review the [operator runbook](../HARDENING_RUNBOOK.md) and [implementation status](../REMEDIATION_STATUS.md).

## TL;DR

- Four providers: **OpenAI**, **Google Gemini**, **Anthropic Claude**,
  and **local Ollama**. Pick a default in config; per-chat overrides
  are persisted.
- **12 registered tools** (effective tools depend on actor/key/whitelist): VirusTotal lookups, AlienVault OTX,
  GitHub releases/advisories, Wikipedia, an SSRF-guarded `fetch_url`,
  and five read-only WhatsApp store queries.
- **Opt-in per chat** — a mention can trigger fallback when consent is unset, but explicit `.ai off` wins over mentions and paid commands. Private mode rejects non-admin fallback.
- **Up to 20 stored turns** per chat, including tool turns. Zero disables memory; message-body privacy policy also blocks it. Existing data is not automatically purged.
- **Daily admission budget** (default `$5/day`) and attempt quotas **30/user/hr**, **100/chat/day**, shared by paid command/fallback entry points. Reservations serialize within one process; they are not a distributed billing guarantee.
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

| Command              | Effect                                         |
| -------------------- | ---------------------------------------------- |
| `.ai`, `.ai status`  | Show status + today's spend vs cap             |
| `.ai on` / `.ai off` | Per-chat opt-in toggle                         |
| `.ai clear`          | Forget conversation memory for this chat       |
| `.ai persona <p>`    | `threat-intel` \| `general` \| `custom`        |
| `.ai provider <p>`   | `openai` \| `gemini` \| `anthropic` \| `local` |
| `.ai model <name>`   | Override the default model                     |

## Admin commands (prefix `$`, name `ai-admin`)

| Command                           | Effect                             |
| --------------------------------- | ---------------------------------- |
| `$ai-admin stats [days]`          | Daily token + cost summary         |
| `$ai-admin chats`                 | List opted-in chats                |
| `$ai-admin limit get / set <usd>` | Read or live-edit cost cap         |
| `$ai-admin enable / disable`      | Flip `config.ai.enabled` in memory |

## Personas

- **`threat-intel`** (default) — security-focused. Cites IoCs / CVEs /
  vendor verdicts and avoids generic advice.
- **`general`** — friendly assistant, no security slant.
- **`custom`** — uses the string in `config.ai.customPersona`.

## Tools (12 by default)

| Tool                   | Needs API key?                        | Returns                          |
| ---------------------- | ------------------------------------- | -------------------------------- |
| `get_blocklist`        | no                                    | current blocked JIDs (sample)    |
| `get_presence_in_chat` | no                                    | recent presence states per JID   |
| `get_labels_for_chat`  | no                                    | WA Business labels on a target   |
| `list_newsletters`     | no                                    | newsletters known to the bot     |
| `get_recent_messages`  | no                                    | last N stored messages in a chat |
| `check_virustotal`     | yes (`config.apis.virustotal.apiKey`) | VT verdict stats + reputation    |
| `search_alienvault`    | yes (`config.apis.alienvault.apiKey`) | OTX pulse summary                |
| `latest_hackernews`    | no                                    | latest THN RSS items             |
| `github_releases`      | optional (token raises rate limit)    | latest releases for repo         |
| `github_advisories`    | optional                              | GHSA matches for a query         |
| `wiki_lookup`          | no                                    | Wikipedia summary (en)           |
| `fetch_url`            | no                                    | GET ≤200 KB; **SSRF-guarded**    |

Tools requiring a key are **automatically hidden** from the model
when the key is missing. The whitelist is configurable via
`config.ai.toolWhitelist`. Global blocklist/newsletter queries additionally require a configured admin; chat/presence/label/message tools cannot target a different chat. The URL tool validates and pins DNS, checks canonical IP ranges and refuses redirects, embedded credentials and unverifiable proxies.

## Cost control

The pricing table lives in `src/services/ai/costTracker.js`:

| Model                      | Prompt $/1M                        | Completion $/1M |
| -------------------------- | ---------------------------------- | --------------- |
| `gpt-4o-mini`              | 0.15                               | 0.60            |
| `gpt-4o`                   | 2.50                               | 10.00           |
| `gemini-2.0-flash`         | 0.10                               | 0.40            |
| `claude-3-5-haiku-latest`  | 0.80                               | 4.00            |
| `claude-3-5-sonnet-latest` | 3.00                               | 15.00           |
| _Local (Ollama)_           | **0**                              | **0**           |
| _unknown model_            | **denied until explicitly priced** | —               |

These are built-in estimates, not verified current provider invoices. Review current models/rates and use `ai.pricing['provider:model'] = [inputUSDPerMillion, outputUSDPerMillion]` for a reviewed custom price. Admission reserves bounded prompt/completion/tool rounds; it denies if recorded plus reserved use would exceed the configured UTC-day cap. This also covers `.ask`, `.explain`, `.summarize` and `.imagine`. It cannot guarantee a provider's actual invoice or coordinate independent replicas.

Missing/uncertain metering is charged as a labeled estimate, not free usage. Ledger failures and unexpected unpriced response models block further paid admission until reconciled. Images use supported fixed-price combinations (default `dall-e-3`); variable-price image models deny until supported. See the runbook for limits, estimate reconciliation and delivery-failure handling.

**v1.4.0**: when daily spend reaches `config.alerts.rules.aiCostPct.threshold`
(default `0.80` = 80%), the alert engine fires once (with cooldown)
to WhatsApp `errLogs` and the Telegram mirror. See
[CI/CD &amp; ops](/deploy/ci-cd) for the Grafana panel.

## Security

- Public-URL fetching validates/pins addresses and refuses unsafe redirects/proxies; other user-derived outbound paths are still being inventoried.
- `/api/ai/config` returns credential presence, not raw keys. Provider authentication still legitimately sends keys to the intended provider; this is not a claim that keys never leave the process.
- Explicit opt-out and private-mode/admin policy apply before provider calls, including paid commands. Tools enforce actor/chat scope independently of model-provided arguments.
- Budget admission is process-local and uses reviewed estimates; provider bills and uncertain rows require reconciliation. A timeout is not cancellation and may leave underlying work running.

## Known limitations

- Streaming is single-message ("composing" presence + one final
  reply), not incremental WA message edits — incremental editing
  was explicitly rejected in v1.3.0 because of ban risk.
- The `provider/model` override stored per chat is honoured by
  `ai.chat()` but not currently surfaced in the dashboard UI.
