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
