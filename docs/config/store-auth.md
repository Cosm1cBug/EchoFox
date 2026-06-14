# Store & Auth Configuration

EchoFox has two pluggable persistence layers:

- **Auth** — Baileys session credentials (signal keys, sender keys, encryption state)
- **Store** — message bodies, group metadata, edits/reactions/receipts, subscribers

Both support multiple backends. They can run on different backends —
e.g. auth on local SQLite while store is on PostgreSQL.

## Auth backends

```js
auth: {
  method: 'MULTIFILE',  // 'MULTIFILE' | 'SQLITE' | 'REDIS' | 'POSTGRES'

  // For SQLITE
  sqlitePath: './src/store/auth.db',

  // For REDIS
  redisUrl: 'redis://localhost:6379',

  // For POSTGRES
  postgresUrl: 'postgresql://postgres:postgres@localhost:5432/echofox',
},
```

| Method      | When to use                                                            |
| ----------- | ---------------------------------------------------------------------- |
| `MULTIFILE` | Default. Files in `src/<sessionName>/`. Fastest, simplest.             |
| `SQLITE`    | When you want one file containing both auth + store data               |
| `REDIS`     | Multi-instance failover (auth shared across multiple worker processes) |
| `POSTGRES`  | Same, when you already run Postgres for other workloads                |

## Store backends

```js
storeDB: {
  type: 'SQLITE',  // 'SQLITE' | 'POSTGRES' | 'MONGODB' | 'REDIS'

  sqlitePath:  './src/store/runtime/wa.db',
  postgresUrl: 'postgresql://postgres:postgres@localhost:5432/echofox',
  mongoUri:    'mongodb://localhost:27017/echofox',
  redisUrl:    'redis://localhost:6379',

  runMigrationsOnBoot: true,
},
```

### Backend trade-offs

| Backend      | Pros                                                | Cons                        |
| ------------ | --------------------------------------------------- | --------------------------- |
| **SQLite**   | Zero ops, fastest single-node, WAL durability       | One process at a time       |
| **Postgres** | Multi-instance, mature, JSONB for meta              | Adds operational dependency |
| **MongoDB**  | Schemaless flexibility, easy to inspect via Compass | Less compact than pg        |
| **Redis**    | Lowest-latency, ideal for ephemeral subscriber data | Volatile by default         |

### Backend feature parity

All 4 backends implement the same interface (`src/store/db.js` docs the contract):

- Messages, chats, contacts, groups, edits, reactions, receipts, deletions
- Per-service subscriptions with arbitrary meta (Phase 3+)
- Item-dedup tracker (`service_sent_items`)
- Statistics + gauges

A backend swap (e.g. SQLite → Postgres) is config-only; no code change.

## Migrations

When `runMigrationsOnBoot: true` (default), the lifecycle's
`selectStore()` runs all pending migrations after construction and
before exposing the store. Failures abort boot loudly.

Manual control:

```bash
npm run migrate              # apply all pending
npm run migrate -- --status  # show status only
```

Migration files live in `src/store/migrations/<backend>/NNN_slug.js`
and are versioned monotonically per backend.

## Recommended deployment combos

- **Solo personal bot**: `auth: MULTIFILE` + `storeDB: SQLITE` (zero infra)
- **Small org (one host)**: same as above with regular backups
- **Multi-instance failover**: `auth: POSTGRES` + `storeDB: POSTGRES`
- **High-volume (many groups, message storage important)**: `storeDB: POSTGRES` with the batched writes (v0.4.6)
