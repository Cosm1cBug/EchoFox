# Deploying EchoFox with Docker

> The fastest, most portable way to run EchoFox in production.
> One container, two persistent volumes, optional Prometheus + Grafana.

## TL;DR

```bash
docker run -d \
  --name echofox \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v echofox-session:/app/src/@session \
  -v echofox-store:/app/src/store/runtime \
  -e TZ=Asia/Kolkata \
  ghcr.io/cosm1cbug/echofox:latest

docker logs -f echofox   # scan the QR
```

After pairing once, the bot survives restarts/rebuilds as long as you keep
the `echofox-session` volume.

---

## Image variants

| Tag | What it is | When to use |
|---|---|---|
| `ghcr.io/cosm1cbug/echofox:latest`  | Latest tagged release | Production. Recommended. |
| `ghcr.io/cosm1cbug/echofox:v0.x.y`  | Specific version      | Pin for reproducible deploys. |
| `ghcr.io/cosm1cbug/echofox:main`    | Latest `main` branch  | Pre-release testing. May break. |
| `cosm1cbug/echofox:*` (Docker Hub)  | Mirror of GHCR        | If GHCR is blocked on your network. |

Multi-arch: every tag ships **`linux/amd64`** and **`linux/arm64`** (works
on Raspberry Pi 4/5, Apple Silicon, AWS Graviton, etc.).

---

## Required volumes

There are exactly **two** directories you must persist:

| Mount point | What's inside | What happens if you lose it |
|---|---|---|
| `/app/src/@session`       | WhatsApp pairing credentials (Baileys auth files) | Bot logs out; you must re-scan QR. |
| `/app/src/store/runtime`  | SQLite DBs: message store, analytics, user directory | Bot loses message-retry cache, stats, user history. Non-fatal. |

Use named volumes (recommended) or bind mounts:

```bash
# Named volumes (managed by Docker)
-v echofox-session:/app/src/@session
-v echofox-store:/app/src/store/runtime

# Bind mounts (live in your filesystem)
-v $HOME/echofox/session:/app/src/@session
-v $HOME/echofox/store:/app/src/store/runtime
```

---

## Configuration

You have two options. Pick one (or combine).

### Option A — Mount your own `config.js`

```bash
docker run -d \
  --name echofox \
  -v $(pwd)/src/config.js:/app/src/config.js:ro \
  -v echofox-session:/app/src/@session \
  -v echofox-store:/app/src/store/runtime \
  ghcr.io/cosm1cbug/echofox:latest
```

The container reads it just like a bare-metal install. `:ro` (read-only) is
recommended — the bot never needs to write the file.

### Option B — Environment variables

Every config field can be overridden via `ECHOFOX_<SECTION>_<CAMELCASEKEY>`:

```bash
docker run -d \
  --name echofox \
  -e ECHOFOX_BOT_PREFIX='.' \
  -e ECHOFOX_BOT_ADMINPREFIX='$' \
  -e ECHOFOX_APIS_OMDB_APIKEY=xxxxx \
  -e ECHOFOX_APIS_VIRUSTOTAL_APIKEY=yyyyy \
  -v echofox-session:/app/src/@session \
  -v echofox-store:/app/src/store/runtime \
  ghcr.io/cosm1cbug/echofox:latest
```

If both are present, **environment variables win** (override config.js).

### Mapping cheat-sheet

| `config.js` path            | Env variable                          |
|---|---|
| `bot.prefix`                | `ECHOFOX_BOT_PREFIX`                  |
| `bot.adminPrefix`           | `ECHOFOX_BOT_ADMINPREFIX`             |
| `bot.public`                | `ECHOFOX_BOT_PUBLIC`                  |
| `features.readMessages`     | `ECHOFOX_FEATURES_READMESSAGES`       |
| `apis.omdb.apiKey`          | `ECHOFOX_APIS_OMDB_APIKEY`            |
| `apis.virustotal.apiKey`    | `ECHOFOX_APIS_VIRUSTOTAL_APIKEY`      |
| `runtime.logLevel`          | `ECHOFOX_RUNTIME_LOGLEVEL`            |
| `runtime.port`              | `ECHOFOX_RUNTIME_PORT`                |
| `channels.botLogs`          | `ECHOFOX_CHANNELS_BOTLOGS`            |

`admins[]` and `channels.*` are simple strings; nested arrays like
`admins=["jid1","jid2"]` are not yet supported via env vars — use Option A
(mount config.js) when you need them.

---

## Health checks

The container's HEALTHCHECK probes `/healthz` every 30 s. Inspect:

```bash
docker inspect --format='{{json .State.Health}}' echofox | jq
```

Manually:

```bash
docker exec echofox curl -fsS http://127.0.0.1:3000/healthz
# → {"status":"ok","uptime":1234,"pid":1}
```

---

## Logs

```bash
docker logs -f --tail=200 echofox
```

Logs are JSON in production (single line per event) — pipe through `jq` or
ship to Loki/CloudWatch/Datadog. To get a single-line summary:

```bash
docker logs --tail=200 echofox | jq -r '"\(.time) \(.level | tostring) \(.msg)"'
```

---

## First-run / pairing

The bot prints the QR code to **stdout**, so:

```bash
docker logs -f echofox
# Wait for: "scan QR to log in:"
# Then the QR appears in the terminal.
```

Scan from WhatsApp → Settings → Linked devices → Link a device.
After successful pairing, you'll see `INFO ✅ connected`.

If you'll be far from the terminal, run **detached without `-d`** the first
time so the QR stays on screen, scan it, then `Ctrl+C` and start it normally
with `-d`. The session is preserved in the volume.

---

## Updates

```bash
docker pull ghcr.io/cosm1cbug/echofox:latest
docker stop echofox && docker rm echofox
# re-run with the same docker run command (volumes preserve the session)
```

Or with Compose: `docker compose pull && docker compose up -d`.

We use semver — minor/patch are safe to auto-update; major versions may have
config migration steps (see CHANGELOG.md).

---

## Troubleshooting

### "unable to verify the first certificate"

Your network is intercepting HTTPS to WhatsApp (corporate proxy, Zscaler,
some hotel WiFi, certain ISPs). Try a different network or VPN. For
diagnostics see the troubleshooting section in `docs/deploy/troubleshooting.md`.

### "loggedOut" or "401" after months of working

Your number got banned, OR you logged the linked device out from your phone.
Wipe the session and re-pair:

```bash
docker stop echofox
docker volume rm echofox-session
docker volume create echofox-session
docker start echofox
docker logs -f echofox   # scan new QR
```

### Container restarts in a loop

```bash
docker logs --tail=80 echofox
```

Common culprits:
- Config validation failed → look for `❌ EchoFox configuration is invalid`
- Port 3000 busy on the host → change with `-p 127.0.0.1:8080:3000`
- Missing `--init` flag → use `init: true` in compose or `--init` in docker run

### "I want fewer logs"

`-e LOG_LEVEL=warn` (options: trace, debug, info, warn, error, fatal).

---

## Building locally

```bash
git clone https://github.com/Cosm1cBug/EchoFox.git
cd EchoFox
docker build -t echofox:local .
docker run -d --name echofox -p 3000:3000 \
  -v echofox-session:/app/src/@session \
  -v echofox-store:/app/src/store/runtime \
  echofox:local
```

For multi-arch builds, see `docs/deploy/multi-arch.md`.
