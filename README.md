# 🦊 EchoFox

> A production-grade WhatsApp bot built on **[Baileys 7.x](https://github.com/WhiskeySockets/Baileys)** — typed, observable, scalable, and friendly to extend.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node ≥20](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![Baileys 7.0.0-rc13](https://img.shields.io/badge/baileys-7.0.0--rc13-orange)](https://www.npmjs.com/package/@whiskeysockets/baileys)
[![Docker Hub](https://img.shields.io/badge/docker-cosm1cbug%2Fechofox-blue?logo=docker)](https://hub.docker.com/r/cosm1cbug/echofox)
[![GHCR](https://img.shields.io/badge/ghcr-Cosm1cBug%2Fechofox-181717?logo=github)](https://github.com/Cosm1cBug/EchoFox/pkgs/container/echofox)

> ⚠️ **Please read [DISCLAIMER.md](./DISCLAIMER.md) before using.** Running an unofficial WhatsApp client may violate WhatsApp's Terms of Service and can result in your number being banned. Use a number you can afford to lose.

---

## ✨ Features

- 🔌 **Baileys 7.x** with the recommended retry, group-metadata, and signal-key caches wired in
- 🧩 **Folder-based command registry** with hot-reload, alias resolution, and auto-skip of commands missing API keys
- 📦 **Pluggable store backend** — SQLite (default), Postgres, MongoDB, or Redis
- 🔑 **Pluggable auth backend** — multi-file (default), Redis, or SQLite
- 🆔 **Login via QR or pairing code**
- 📊 **Built-in web dashboard** at `:3001` (optional)
- 🚦 **Per-chat queue** for back-pressure — one slow command no longer stalls the whole bot
- ❤️ **Health & metrics** at `GET /healthz` and `GET /metrics` (Prometheus)
- 📝 **Structured logging** via [pino](https://github.com/pinojs/pino) (pretty in dev, JSON in prod)
- 🛡️ **Built-in middleware** for inbound rate-limiting and outbound concurrency capping
- 🛟 **Centralised command runner** with per-command timeouts, cooldowns, and crash → ❌ react + ops-channel report
- 🔄 **Supervisor + worker** model with exponential-backoff restart and graceful shutdown
- 🌐 **Dual prefix** — `.` for users, `$` for admins
- 🧪 **Zod-validated config** with auto-translation of legacy v5/v6 `config.js` files

---

## 🚀 Quick start

### Prerequisites

- **Node.js ≥ 20** (Baileys 7.x requires it — `node -v` to check)
- Python 3 + a C compiler (for `better-sqlite3`'s native build)
  - Debian/Ubuntu: `sudo apt install -y build-essential python3`
  - macOS: `xcode-select --install`
  - Windows: install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- A spare WhatsApp number you don't mind losing

### Install

```bash
git clone https://github.com/Cosm1cBug/EchoFox.git
cd EchoFox
npm install
```

### Configure

```bash
cp src/config.example.js src/config.js
# Open src/config.js and set at least:
#   admins[]              — your own WhatsApp JID (so $ commands work)
#   apis.*.apiKey         — any optional API keys you have
#   dashboard.password    — change from default if you enable the dashboard
```

You can also override any config field with environment variables (handy for Docker):

```bash
ECHOFOX_BOT_PREFIX=! ECHOFOX_APIS_OMDB_APIKEY=xxx npm start
```

### Run

```bash
npm run dev          # development mode (pretty logs, debug level)
# OR
NODE_ENV=production npm start
```

A QR code will appear in the terminal. Scan it from **WhatsApp → Settings → Linked devices → Link a device**. After pairing:

```bash
# In another terminal:
curl http://localhost:3000/healthz
# → {"status":"ok","uptime":12.4,"pid":12345}

# From another WhatsApp account:
# Send ".ping" to your bot number → should reply within ~150 ms
```

---

## 📦 Built-in commands

Type `.menu` in any chat with the bot to see the live list. By category:

| Category | Commands |
|---|---|
| **main**           | `menu` |
| **misc**           | `ping`, `quote`, `test`, `eval` *(admin)*, `anti-viewOnce`, `sendstory` |
| **general**        | `wiki`, `translate`, `ctx`, `virustotal` *, `alienvault` *, `thehackernews` |
| **download**       | `apkdl`, `mediaGrabber`, `mediafire`, `pinterest`, `spotify`, `song` |
| **convert**        | `sticker`, `stk`, `toimg`, `tts` |
| **entertainment**  | `omdb` * |
| **group**          | `link`, `approve` |
| **tools**          | `ssweb` |
| **user**           | `profile` |
| **admin**          | `serverinfo` |

`*` = requires an API key in `src/config.js`; auto-disabled if missing.

Run `npm run docs:commands` to regenerate the full catalog at `docs/commands.md`.

---

## 🏗️ Architecture

```
                       ┌─────────────────────────────────────────────┐
                       │       src/core/bootstrap.js   (supervisor)   │
                       │  • Express :3000  /healthz /metrics          │
                       │  • fork(worker.js) + exp-backoff restart     │
                       │  • SIGTERM/SIGINT graceful shutdown          │
                       └────────────────────┬────────────────────────┘
                                            │ IPC
                                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       src/core/worker.js                              │
│   ┌────────────────────┐    ┌──────────────────────────────────────┐ │
│   │ configLoader (zod) │    │   makeWASocket  (Baileys 7.x)        │ │
│   │ commandRegistry    │◄──►│  • cachedGroupMetadata via store     │ │
│   │ commandRunner      │    │  • getMessage → proto.IMessage       │ │
│   │ caches (× 7)       │    │  • 5 named retry/device/call caches  │ │
│   └────────────────────┘    └────────────────┬─────────────────────┘ │
│                                              │                       │
│         ┌────────────────────────────────────▼─────────────┐        │
│         │  per-chat p-queue (concurrency=1, parallel chats)│        │
│         │  ──► events/messages.upsert.js                   │        │
│         │      ──► commandRunner.run(cmd) ──► cmd.start()  │        │
│         └──────────────────────────────────────────────────┘        │
│                                                                       │
│   store: sqlite | postgres | mongo | redis (pluggable via storeDB)   │
│   auth:  multi-file | sqlite | redis (pluggable via auth.method)     │
│   middleware/{rateLimit, sendQueue}  ·  optional dashboard :3001     │
└──────────────────────────────────────────────────────────────────────┘
```

Full architecture deep-dive in [UPGRADE.md](./UPGRADE.md).

---

## ⚙️ Configuration reference

Edit `src/config.js`. Every field has a sensible default; you can leave most empty.

| Path | Type | Default | Description |
|---|---|---|---|
| `bot.name`              | string  | `"EchoFox"`     | Bot display name |
| `bot.prefix`            | string\|RegExp | `"."` | User-command prefix |
| `bot.adminPrefix`       | string\|RegExp | `"$"` | Admin-command prefix |
| `bot.sessionName`       | string  | `"@session"`    | Folder name for WA auth files |
| `bot.timezone`          | string  | `"Asia/Kolkata"`| IANA timezone for logs / scheduling |
| `bot.public`            | boolean | `true`          | `false` = admin-only mode |
| `features.readMessages` | boolean | `true`          | Mark incoming msgs as read |
| `features.readStatus`   | boolean | `true`          | Mark statuses as read |
| `features.antiCall`     | boolean | `false`         | Auto-reject incoming calls |
| `features.syncHistory`  | boolean | `true`          | Pull full history on first login |
| `login.type`            | enum    | `"QR"`          | `"QR"` or `"PAIRING"` |
| `login.phoneNumber`     | string  | `""`            | Required if `type="PAIRING"` (digits only) |
| `auth.method`           | enum    | `"MULTIFILE"`   | `"MULTIFILE"` / `"REDIS"` / `"SQLITE"` |
| `auth.redisUrl`         | string  | `redis://...`   | Used when `method="REDIS"` |
| `auth.sqlitePath`       | string  | `./src/store/auth.db` | Used when `method="SQLITE"` |
| `storeDB.type`          | enum    | `"SQLITE"`      | `"SQLITE"` / `"POSTGRES"` / `"MONGODB"` / `"REDIS"` |
| `storeDB.sqlitePath`    | string  | `./src/store/runtime/wa.db` | |
| `storeDB.postgresUrl`   | string  | `postgresql://...` | |
| `storeDB.mongoUri`      | string  | `mongodb://...` | |
| `storeDB.redisUrl`      | string  | `redis://...`   | |
| `dashboard.enabled`     | boolean | `false`         | Built-in web UI |
| `dashboard.port`        | number  | `3001`          | |
| `dashboard.username`    | string  | `"admin"`       | |
| `dashboard.password`    | string  | `"change-me-please"` | ⚠️ change this |
| `processing.concurrencyPerChat` | number | `1`     | FIFO per chat, parallel across chats |
| `processing.globalRateLimit`    | number | `20`    | Commands per second across whole bot |
| `processing.userRateLimit`      | number | `10`    | Commands per minute per sender |
| `processing.sendConcurrency`    | number | `4`     | Outbound `sendMessage` in-flight cap |
| `admins[]`              | string[]| `[]`            | Admin JIDs (`1234567890@s.whatsapp.net`) |
| `channels.{syslogs,botLogs,userLogs,…}` | string | `""` | Group JIDs for log streams (empty = disabled) |
| `apis.omdb.apiKey`      | string  | `""`            | OMDb API key (for `.omdb`) |
| `apis.virustotal.apiKey`| string  | `""`            | VirusTotal API key |
| `apis.alienvault.apiKey`| string  | `""`            | AlienVault OTX API key |
| `runtime.logLevel`      | enum    | `"info"`        | `trace`/`debug`/`info`/`warn`/`error`/`fatal` |
| `runtime.port`          | number  | `3000`          | `/healthz` + `/metrics` port |

Every field can also be set via an environment variable:
`ECHOFOX_<SECTION>_<CAMELCASEKEY>` — e.g. `ECHOFOX_APIS_OMDB_APIKEY=xyz`, `ECHOFOX_STOREDB_TYPE=POSTGRES`.

---

## ✍️ Writing your own commands

Create a file in `src/commands/<category>/<name>.js`:

```js
module.exports = {
  name: 'hello',
  alias: ['hi', 'hey'],
  desc: 'Say hello',
  category: 'misc',                  // (optional — defaults to folder name)
  admin: false,                      // (optional — restricts to admins)
  group: false,                      // (optional — group-only)
  needsMetadata: false,              // (optional — pre-fetch group metadata)
  requires: ['apis.omdb.apiKey'],    // (optional — auto-skip if config path is empty)
  cooldown: 0,                       // (optional — seconds between uses per user)
  timeout: 60,                       // (optional — per-invocation timeout, seconds)

  async start(sock, m, { ctx, args, prefix, config, logger }) {
    // m   = raw Baileys message + legacy m.sender, m.from, m.isGroup, m.reply, …
    // ctx = clean parsed view (preferred for new code)
    await ctx.reply(`Hello, ${ctx.pushName}! You said: ${args.join(' ')}`);
  },
};
```

The bot **hot-reloads** the command when you save the file — no restart needed.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full authoring guide.

---

## 📊 Observability

```bash
curl http://localhost:3000/healthz
curl http://localhost:3000/metrics
```

Prometheus metrics exposed (besides the defaults):

| Metric | Type | Description |
|---|---|---|
| `echofox_worker_up`               | gauge   | 1 if the worker is alive |
| `echofox_worker_restarts_total`   | counter | Cumulative supervisor restarts |

Grafana dashboard JSON: `docker/grafana/dashboards/echofox-overview.json` (auto-provisioned by the Compose `observability` profile).

---

## 🐳 Docker

The fastest, most portable way to run EchoFox. Multi-arch images
(`linux/amd64`, `linux/arm64`) published to **GHCR** and **Docker Hub** on
every tagged release.

### One-liner

```bash
docker run -d \
  --name echofox \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v echofox-session:/app/src/@session \
  -v echofox-store:/app/src/store/runtime \
  -e TZ=Asia/Kolkata \
  ghcr.io/cosm1cbug/echofox:latest

docker logs -f echofox    # scan the QR
```

### Docker Compose

```bash
cp .env.example .env
docker compose up -d

# With Prometheus + Grafana:
docker compose --profile observability up -d
# → Grafana at http://localhost:3001 (admin / changeme)
```

### Full guides
- [docs/deploy/docker.md](./docs/deploy/docker.md) — single container, env vars, volumes, updates
- [docs/deploy/docker-compose.md](./docs/deploy/docker-compose.md) — Compose + observability profile
- [docs/deploy/podman.md](./docs/deploy/podman.md) — rootless alternative
- [docs/deploy/multi-arch.md](./docs/deploy/multi-arch.md) — building your own multi-arch images
- [docs/deploy/troubleshooting.md](./docs/deploy/troubleshooting.md) — when things go wrong

---

## 🛣️ Roadmap

| Milestone | Status | Tag |
|---|---|---|
| **M0** — New core boots, pairs, replies     | ✅ | `v0.1.0-alpha` |
| **M1** — OSS readiness (licensing, config, docs) | ✅ | `v0.2.0-alpha` |
| **M2** — Docker + multi-platform images     | ✅ | `v0.3.0-alpha` |
| **M3** — Commands triage & rewrite          | ✅ | `v0.4.0-beta` (reconciled in `v0.4.1-beta`) |
| **M4** — CI/CD + automated releases         | 🔜 | `v0.5.0-rc1` |
| **M5** — Docs site (vitepress)              | 🔜 | `v1.0.0-rc1` |
| **M6** — 2-week soak test → public release  | 🔜 | `v1.0.0` |

---

## 🤝 Contributing

Pull requests welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md).

By participating, you agree to behave kindly and constructively.

---

## 🔐 Security

Found a vulnerability? Please report it privately — see [SECURITY.md](./SECURITY.md).

---

## 📜 License

Licensed under the [GNU Affero General Public License v3.0 or later](./LICENSE).

In short: if you run a modified version of EchoFox as a service, you must offer the source of your modifications to the users who interact with it over the network. Third-party attributions in [NOTICE](./NOTICE).

---

## 💖 Acknowledgements

- **[Baileys](https://github.com/WhiskeySockets/Baileys)** by @PurpShell and contributors — none of this would exist without their reverse-engineering
- The original **EchoFox v5** community for the initial command library
- Everyone who's filed a bug or sent a PR

---

*EchoFox is not affiliated with WhatsApp or Meta. WhatsApp™ is a trademark of WhatsApp LLC.*