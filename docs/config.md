# Configuration Reference

EchoFox uses a Zod-validated configuration system.

## Main Sections

- `bot` — Bot behavior and prefixes
- `features` — Enable/disable features
- `auth` — Authentication backend
- `storeDB` — Database backend
- `apis` — Third-party API keys

See `src/config.example.js` for the full reference.

## Hardening behavior and external configuration

See the [operator runbook](./HARDENING_RUNBOOK.md) for canonical/legacy precedence, typed environment aliases, external `ECHOFOX_CONFIG`, privacy/consent, budget prices and dashboard/metrics secrets. All newer sections are retained rather than silently discarded. Invalid canonical values or unknown/conflicting environment aliases fail instead of being replaced by defaults. Validate with `npm run config:check` before starting connections.

Configuration validation proves schema validity, not feature readiness or production safety. Review the [F01–F24 status](./REMEDIATION_STATUS.md) before enabling a previously dormant feature. Shutdown/reconnect is deliberately unchanged.

## WhatsApp media upload timeout

`network.mediaUploadTimeoutMs` controls the **per-host socket inactivity timeout** for WhatsApp media uploads. Default: `30000` ms; valid range: integer `1000`–`300000` ms. Merge this into your existing network configuration, preserving any proxies and custom CA settings:

```js
network: {
  mediaUploadTimeoutMs: 30000,
}
```

The environment equivalent is `ECHOFOX_NETWORK_MEDIA_UPLOAD_TIMEOUT_MS=30000`. Validate with `npm run config:check` and restart the worker after changing it.

Baileys 7's Node HTTPS uploader can inherit Node's global agent timeout (5 seconds in Node 22) when callers omit an upload timeout. EchoFox now supplies a dedicated, cached media agent through `fetchAgent`, with the same SOCKS/HTTPS-proxy selection and custom CA trust settings. WebSocket and Axios agents are not modified. This covers ordinary image/video/sticker/document uploads, high-quality link-preview images, and direct media-preparation calls. The carousel and thumbnail menus also pass the setting explicitly to Baileys as `mediaUploadTimeoutMs`.

This setting is separate from `network.fetchTimeoutMs` (Axios), `connectTimeoutMs` (WhatsApp socket connection), and command execution deadlines. It is **not** an end-to-end upload deadline: Baileys can try multiple CDN hosts, and each host may take up to its inactivity limit. Progressing requests and retries can therefore outlast a command's existing deadline; raising this setting does not extend those deadlines or add cancellation. Start with the default rather than blindly increasing it.

If uploads still time out, compare `.menu list`/`.menu all` (no image upload) with `.menu thumbnail`, inspect subsequent host-retry logs, and check the bot machine's CDN connectivity/proxy configuration. A longer timeout cannot repair blocked routes. Do not delete credentials, disable TLS verification, or change a WhatsApp Web version pin solely because of an upload timeout.
