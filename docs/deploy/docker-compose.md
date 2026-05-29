# Deploying EchoFox with Docker Compose

The repo ships with a production-ready `docker-compose.yml` plus an
optional `observability` profile (Prometheus + Grafana).

---

## Quick start

```bash
git clone https://github.com/Cosm1cBug/EchoFox.git
cd EchoFox

cp .env.example .env             # edit if you want non-default settings

docker compose up -d
docker compose logs -f echofox   # scan the QR
```

That's it. Single bot, two named volumes, restart-on-failure, log rotation.

---

## With observability stack

```bash
docker compose --profile observability up -d
```

This brings up:

| Service     | Image                | Local URL                  |
|---|---|---|
| `echofox`     | `ghcr.io/cosm1cbug/echofox:latest` | `http://localhost:3000` |
| `prometheus`  | `prom/prometheus:v2.55.1`          | `http://localhost:9090` |
| `grafana`     | `grafana/grafana:11.3.0`           | `http://localhost:3001` |

Grafana is pre-provisioned with:
- Prometheus as the default data source
- The **EchoFox Overview** dashboard (under "EchoFox" folder)

Default Grafana login is `admin / changeme` — change via `.env`:

```env
GRAFANA_USER=admin
GRAFANA_PASSWORD=your-secure-password
```

---

## Dev mode (live-reload from your local source)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This:
- Builds the image locally from your working tree
- Bind-mounts `src/` so file edits hot-reload the command registry
- Switches log level to `debug` with pretty formatting
- Exposes `:3000` on all interfaces (LAN-accessible)
- Disables the health check (so dev crashes don't trigger restart loops)

---

## Updating

```bash
docker compose pull
docker compose up -d
```

The volumes (`echofox-session`, `echofox-store`) survive container
recreation — you do **not** lose the WhatsApp pairing.

---

## Stopping

```bash
docker compose down              # stop containers, keep volumes
docker compose down -v           # ⚠️ also deletes volumes (loses session!)
```

---

## Customising

To add your own services (e.g. a reverse proxy, a backup sidecar), create
a `docker-compose.override.yml` in the same directory — Compose merges it
automatically. Example:

```yaml
# docker-compose.override.yml
services:
  caddy:
    image: caddy:2-alpine
    ports: ["443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    networks: [echofox]

volumes:
  caddy-data:
```

---

## Backups

The only thing you really must back up is `echofox-session`. A simple
nightly cron is enough:

```bash
0 3 * * * docker run --rm \
  -v echofox-session:/source:ro \
  -v /backup/echofox:/backup \
  alpine \
  tar czf /backup/session-$(date +\%Y\%m\%d).tar.gz -C /source .
```

Keep the last 7 days. Restore by extracting back into the volume.
