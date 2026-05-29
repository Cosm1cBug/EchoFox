# EchoFox Documentation

> The full docs site lives at <https://cosm1cbug.github.io/echofox> (published in Milestone M5).
> Until then, the source markdown lives here.

## Deployment

- [Docker](./deploy/docker.md) — single-container production deploy
- [Docker Compose](./deploy/docker-compose.md) — with optional Prometheus + Grafana
- [Podman (rootless)](./deploy/podman.md) — alternative to Docker
- [Multi-arch builds](./deploy/multi-arch.md) — building for amd64 + arm64
- [Troubleshooting](./deploy/troubleshooting.md) — common deployment issues

## Architecture & migration

- [UPGRADE.md](../UPGRADE.md) — Baileys 6 → 7 migration & architecture deep-dive
- [README.md](../README.md) — project overview, quickstart, configuration reference

## Contributing

- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to add commands and open PRs
- [SECURITY.md](../SECURITY.md) — responsible vulnerability disclosure
- [DISCLAIMER.md](../DISCLAIMER.md) — WhatsApp ToS, ban risk, anti-spam policy

## Reference (planned for M5)

- [ ] Configuration reference (auto-generated from `src/lib/configSchema.js`)
- [ ] Command catalog (auto-generated from `src/commands/**`)
- [ ] Prometheus metrics catalog
- [ ] FAQ
