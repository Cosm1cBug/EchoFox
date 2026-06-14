# Deployment Troubleshooting

Common problems and how to diagnose them.

## `unable to verify the first certificate` / `unknown CA`

Symptom — Baileys loops with `connection errored` and the stack mentions
TLS / `unable to get local issuer certificate`.

**Cause:** something on your network is intercepting HTTPS traffic to
`*.whatsapp.com` and presenting a certificate signed by a CA your machine
doesn't trust. Most common offenders:

- Corporate / school firewalls (Zscaler, Cisco Umbrella, Fortinet, Palo Alto)
- Some hotel and airport WiFi
- ISPs in certain countries (UAE, China, parts of India)
- Antivirus software with HTTPS scanning enabled (Kaspersky, Bitdefender, ESET)
- Your home router's "parental controls" / "safe browsing"

### Quickly verify

```bash
# What does the network present as WhatsApp's certificate?
echo | openssl s_client -connect web.whatsapp.com:443 -servername web.whatsapp.com 2>/dev/null \
  | openssl x509 -noout -issuer
```

If the `issuer` line names **anything other than** DigiCert / Cloudflare / Let's Encrypt / WhatsApp / Meta, your network is intercepting.

### Fixes (pick one)

| Situation                                 | Fix                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Corporate proxy you control               | Export the proxy's root CA → drop it into `/usr/local/share/ca-certificates/` → `sudo update-ca-certificates` (Linux). Set `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt`. |
| Antivirus on the host                     | Disable HTTPS scanning for `*.whatsapp.com` and `*.whatsapp.net` in your AV's settings.                                                                                              |
| Restrictive ISP / hotel WiFi              | Use mobile hotspot or a VPN (Mullvad, ProtonVPN, Tailscale).                                                                                                                         |
| Node ≥ 22, want to use the OS trust store | `NODE_OPTIONS=--use-system-ca npm start`                                                                                                                                             |
| Local dev VM, accept the risk             | `NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev` ⚠️ **dev only — never in prod**                                                                                                         |

---

## "Waiting for this message" / decryption stuck

If you upgraded from an older fork that _wasn't_ the EchoFox v0.1.0+ rewrite,
your old store's `getMessage` may be returning the wrong shape.

**Verify:** start with a clean session.

```bash
# Bare metal
rm -rf src/@session

# Docker
docker volume rm echofox-session
docker volume create echofox-session
```

Then re-pair and the message should be re-decrypted fresh.

---

## Port 3000 already in use

```bash
# Linux/macOS
sudo lsof -i :3000      # find what's holding it
sudo kill <PID>

# OR: change EchoFox's port
ECHOFOX_RUNTIME_PORT=4000 npm start
# Docker:
docker run … -p 127.0.0.1:4000:4000 -e ECHOFOX_RUNTIME_PORT=4000 …
```

---

## Bot pairs successfully then immediately disconnects with code 401 / 403

Your number was logged out. Either:

- You manually logged out via WhatsApp → Linked devices, OR
- Your number got **banned** by WhatsApp's anti-automation systems

If you triggered the latter, see [DISCLAIMER.md](../../DISCLAIMER.md).
Wipe the session and try a different number — but understand that running
this in violation of WhatsApp's ToS will continue to result in bans.

---

## `better-sqlite3` failed to install

You're missing build tools for native modules.

| OS              | Fix                                                                                |
| --------------- | ---------------------------------------------------------------------------------- |
| Debian / Ubuntu | `sudo apt install -y build-essential python3`                                      |
| Fedora / RHEL   | `sudo dnf groupinstall "Development Tools" && sudo dnf install python3`            |
| Alpine          | `apk add --no-cache python3 make g++ gcc libc-dev`                                 |
| macOS           | `xcode-select --install`                                                           |
| Windows         | Install **Visual Studio Build Tools** with "Desktop development with C++" workload |

In Docker, this is already handled by the builder stage.

---

## Logs are pure JSON noise — I want them pretty

Set `NODE_ENV=development` (or omit it) and EchoFox uses `pino-pretty`:

```bash
NODE_ENV=development npm start
```

For Docker, pipe through pino-pretty on the host:

```bash
docker logs -f echofox 2>&1 | npx pino-pretty
```

---

## "JSON.parse: Unexpected non-whitespace character"

This is a known noisy log from Baileys 7.0.0-rc13's `process-message.ts:669`.
**EchoFox already silences it** (demotes to debug). If you still see it,
ensure your `src/core/logger.js` is up to date (it should contain
`NOISE_PATTERNS`). The bot is not malfunctioning.

---

## Health endpoint returns 503 forever

```bash
curl -v http://localhost:3000/healthz
```

If it says `"status":"down","pid":null`, the worker died on boot. Check
`docker logs` / `npm run dev` output for a stack trace — usually a config
validation failure or a missing API key for a command without `requires:`.

---

## Performance is poor / event loop lagging

```bash
curl -s http://localhost:3000/metrics | grep -E "eventloop_lag|resident_memory"
```

Targets to stay under:

- `nodejs_eventloop_lag_p99_seconds` < 0.05
- `process_resident_memory_bytes` < 300 MB for a single bot with < 5 k chats

If exceeded, file a bug with the metric snapshot and a sample of slow
commands you've been running.
