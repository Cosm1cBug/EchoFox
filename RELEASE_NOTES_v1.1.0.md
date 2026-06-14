# EchoFox v1.1.0 — Full WhatsApp event automation 🦊

After v1.0.x's stabilisation cycle, v1.1.0 turns every Baileys event
into real persisted data. The 16 handlers that previously just logged
now write into proper backing tables, exposed via 16 new `/api/*` routes,
backed by 22 new store methods per backend × 4 backends.

This is the **data foundation for v1.2.0** (multi-provider AI chatbot
with threat-intel persona + tool-calling), so the AI can actually
introspect bot state instead of being a chat wrapper around OpenAI.

## TL;DR

- **All 16 stub event handlers now persist** — blocklist, presence,
  chat state, contacts (extended), labels, newsletters (with views +
  reactions + settings), LID mapping, message capping
- **16 new `/api/*` routes** for dashboard + AI tool-calling
- **11 new tests** covering all new store methods (**101 / 101 passing**)
- **Migration 004** (`extended_events`) for all 4 backends; idempotent + auto-runs on boot
- **22 new store methods × 4 backends** with full feature parity
- **Fixes a critical Redis-backend regression** from v1.0.x where the
  `K` namespace constant wasn't declared
- **Zero breaking changes** — drop-in upgrade from v1.0.x

## Upgrade from v1.0.x

```bash
git pull
npm install
npm start          # migrations run automatically on boot
```
