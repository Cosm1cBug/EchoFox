# Architecture Overview

EchoFox follows a Supervisor + Worker model.

## Core Components

- **bootstrap.js** — Supervisor process
- **worker.js** — Main bot logic
- **lifecycle.js** — Boot orchestration
- **store/** — Pluggable database layer
- **auth/** — Pluggable authentication layer

For full details, refer to `UPGRADE.md`.
