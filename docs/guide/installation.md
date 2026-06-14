# Installation

EchoFox runs on Node.js 18+ (recommended: 20+ LTS, tested on 22 too).

## Quick install

```bash
git clone https://github.com/Cosm1cBug/EchoFox.git
cd EchoFox
npm install
cp src/config.example.js src/config.js
# Edit src/config.js with your values, then:
npm start
```

On first start, the bot prints a QR code (or pairing-code prompt) to
the console. Scan with WhatsApp → Linked Devices → Link a Device.

## System requirements

|      | Minimum                 | Recommended                |
| ---- | ----------------------- | -------------------------- |
| Node | 18                      | 20 LTS                     |
| RAM  | 512 MB                  | 1 GB                       |
| Disk | 200 MB                  | 2 GB (for message history) |
| OS   | Linux / macOS / Windows | Linux (Ubuntu 22+)         |

## Optional dependencies

Some commands need additional binaries or services:

| Command / feature     | Needs                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- |
| `.sticker` / `.toimg` | `ffmpeg` (or `webpmux`) on PATH                                                         |
| `.tts`                | `ffmpeg`                                                                                |
| `.spotify` / `.song`  | `@distube/ytdl-core` (auto-installed via package.json)                                  |
| Postgres store        | Running PostgreSQL 14+                                                                  |
| MongoDB store         | Running MongoDB 6+                                                                      |
| Redis store           | Running Redis 6+                                                                        |
| Dashboard build       | nothing extra; `scripts/build-dashboard.js` runs npm install in dashboard/ on first run |

## Running with PM2

```bash
npm install -g pm2
npm run pm2
```

`ecosystem.config.js` is included at the repo root.

## Docker

See [Deploy → Docker](/deploy/docker) for full setup. Short version:

```bash
docker-compose up -d
```

## First-time configuration

The minimum viable `config.js`:

```js
module.exports = {
  bot: { prefix: '.', adminPrefix: '$' },
  admins: ['YOUR-PHONE-NUMBER@s.whatsapp.net'],
  storeDB: { type: 'SQLITE' },
  auth: { method: 'MULTIFILE' },
  dashboard: { enabled: true, username: 'admin', password: 'CHANGE-ME' },
};
```

See [Configuration](/config) for the full reference (50+ optional
fields with sensible defaults).

## Verifying the install

After `npm start` + linking your phone:

1. Send a private message to your bot's number with `.menu` — you
   should see the command list
2. Visit `http://localhost:3001/dashboard/` and log in with the
   dashboard credentials
3. Check the worker log for any `ERROR` or `FATAL` lines (should
   be none on a clean install)

## Upgrading

```bash
git pull
npm install
npm run build:dashboard   # rebuild the dashboard (also auto-runs on next start)
npm start
```

Migrations run automatically on boot (`runMigrationsOnBoot: true` default).
For a manual migration pass:

```bash
npm run migrate
```

## Uninstalling

```bash
# Remove the bot's WhatsApp session (next start will require re-pairing)
rm -rf src/@session

# Or with a custom sessionName
rm -rf src/<your-sessionName>

# Wipe message store
rm -rf src/store/runtime
```
