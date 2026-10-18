# EchoFox v1.20.0

## Highlights

- Persistent change timelines across SQLite, PostgreSQL, MongoDB, and Redis.
- History panels on every dashboard page except Overview, with a history API
  for querying recorded changes.
- Timeline recording for chat, contact, group, newsletter, label, blocklist,
  presence, call, connection, subscription, AI, alert, XP, and metric activity.
- Legacy SQLite message-capping upgrade fixes the missing `info` column startup
  failure.

## Upgrade

Back up your database before upgrading. Run the normal database migrations for
SQL-backed and MongoDB deployments; Redis does not need a timeline migration.
The SQLite message-capping column upgrade also runs during store initialization.

History starts with activity recorded after this upgrade; past changes are not
backfilled.

## Release contents

This release includes the history/timeline feature patch and the legacy
message-capping fix. It does not include the separately supplied singleton/auth
migration patch.
