# Deploying EchoFox with Podman (rootless)

Podman is a drop-in replacement for the Docker CLI that runs containers
**without a root daemon**. Recommended on multi-tenant Linux servers and
anywhere "no root daemon" is a policy.

Almost every `docker` command in this repo works with `podman` by simply
swapping the binary — but there are 2 gotchas. Read on.

---

## Quick start (rootless)

```bash
podman run -d \
  --name echofox \
  --restart=on-failure:10 \
  --userns=keep-id \
  -p 127.0.0.1:3000:3000 \
  -v echofox-session:/app/src/@session:Z \
  -v echofox-store:/app/src/store/runtime:Z \
  -e TZ=Asia/Kolkata \
  ghcr.io/cosm1cbug/echofox:latest

podman logs -f echofox   # scan QR
```

The `:Z` suffix tells SELinux to relabel the volumes for the container
(omit on non-SELinux distros — Ubuntu, Debian without SELinux).

---

## Auto-start on boot (systemd user unit)

```bash
mkdir -p ~/.config/systemd/user
podman generate systemd --new --name echofox \
  > ~/.config/systemd/user/container-echofox.service

systemctl --user daemon-reload
systemctl --user enable --now container-echofox.service

# Persist across logouts:
loginctl enable-linger $USER
```

`systemctl --user status container-echofox` shows logs + state.

---

## Compose with podman

`podman-compose` (Python) works for simple cases; for full parity use
**Podman 4+'s built-in compose support**:

```bash
podman compose up -d
```

Or use the modern `quadlet` system (Podman 4.4+):

```ini
# ~/.config/containers/systemd/echofox.container
[Unit]
Description=EchoFox WhatsApp bot
After=network-online.target

[Container]
Image=ghcr.io/cosm1cbug/echofox:latest
ContainerName=echofox
PublishPort=127.0.0.1:3000:3000
Volume=echofox-session:/app/src/@session:Z
Volume=echofox-store:/app/src/store/runtime:Z
Environment=TZ=Asia/Kolkata
HealthCmd=curl -fsS http://127.0.0.1:3000/healthz
HealthInterval=30s
HealthRetries=3

[Service]
Restart=always

[Install]
WantedBy=default.target
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user start echofox.service
```

---

## Gotchas vs Docker

| Gotcha                                          | Fix                                                         |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `Permission denied` on bind-mounts              | Add `:Z` (SELinux) or `:z` (shared)                         |
| UID inside container doesn't match host         | Add `--userns=keep-id`                                      |
| Container can't reach host services             | Use `host.containers.internal` (not `host.docker.internal`) |
| `podman compose` ignores `depends_on.condition` | Upgrade to Podman 5+ or rewrite with healthcheck loops      |
| `podman` doesn't auto-start at boot             | Use `systemd --user` units + `loginctl enable-linger`       |

---

## Why use Podman?

- Rootless by default (one less attack surface)
- No daemon → no single point of failure
- Pods (group of containers sharing network) without Kubernetes overhead
- Drop-in CLI compatibility with Docker
- Better default for self-hosted / single-VPS deployments
