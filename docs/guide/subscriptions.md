# Subscriptions

EchoFox can subscribe you to threat-intelligence feeds, cybersecurity news,
software releases, security advisories, and arbitrary RSS/Atom feeds —
all delivered as WhatsApp messages on a schedule.

Every subscription is **per-user** (your JID), opt-in via a private chat
with the bot. Subscriptions persist across bot restarts.

## Subscription sources

| Command | Source | Default interval |
|---|---|---|
| `.alienvault` | AlienVault OTX pulse digests | 60 min |
| `.thehackersnews` | The Hacker News articles | 60 min |
| `.rss` | Any RSS/Atom feed (multiple per user) | 30 min |
| `.github` | GitHub releases + security advisories | 60 min |
| `.vtwatch` | VirusTotal verdict changes | 360 min (6h) |

## Common verb pattern

Every subscription command supports the same lifecycle:

- `<command> on` / `add` — subscribe
- `<command> off` / `remove` — unsubscribe
- `<command> -status` / `list` — show your current state
- `<command> help` — show full usage panel

## AlienVault OTX pulses

Receive curated threat-intelligence pulse digests from AlienVault OTX,
delivered every hour.

```text
.alienvault on
.alienvault -status
.alienvault off
```

Each pulse includes the title, author, TLP rating, top tags, a truncated
description, IOC count, and a link to the OTX page. Requires
`config.apis.alienvault.apiKey`.

## The Hacker News (with topic filter)

Subscribe to The Hacker News articles. You can optionally filter by
topic tags from the RSS feed.

```text
.thehackersnews on                          # all articles
.thehackersnews on malware ransomware       # OR-match against tags
.thehackersnews on cloud-security           # update existing filter
.thehackersnews -status                     # shows current topics
```

Topic matching is case-insensitive against the article's
`<category>` tags. Empty filter delivers everything.

## Generic RSS

Subscribe to **any** RSS or Atom feed (limit: 20 feeds per user).

```text
.rss add https://example.com/feed.xml                    # all articles
.rss add https://example.com/feed.xml security cloud     # topic filter
.rss list                                                 # show your feeds
.rss remove https://example.com/feed.xml
```

Useful feeds:
- `https://hnrss.org/frontpage` — Hacker News front page
- `https://feeds.feedburner.com/TheHackersNews` — same as `.thehackersnews`
- `https://www.bleepingcomputer.com/feed/` — BleepingComputer
- `https://github.com/{owner}/{repo}/releases.atom` — GitHub releases (Atom)

## GitHub releases + advisories

```text
.github releases nodejs/node           # new releases
.github advisories openssl/openssl     # security advisories
.github watch microsoft/vscode         # BOTH releases + advisories
.github list
.github remove nodejs/node
```

Advisories include severity (🔴 critical / 🟠 high / 🟡 medium / 🟢 low),
GHSA / CVE IDs, and summary. Set `config.apis.github.token` (a PAT) to
raise the rate limit from 60/h to 5000/h.

## VirusTotal verdict watch

Monitor changes in VT detection counts on hashes / IPs / domains / URLs.
Alerts ONLY when the malicious-engine count changes.

```text
.vtwatch add hash:44d88612fea8a8f36de82e1278abb02f
.vtwatch add ip:1.2.3.4
.vtwatch add domain:example.com
.vtwatch add url:https://example.com/foo
.vtwatch list
.vtwatch remove hash:44d88612fea8a8f36de82e1278abb02f
```

Requires `config.apis.virustotal.apiKey`. First check records a baseline
without alerting; alerts fire on subsequent cycles when the count
changes.

## Admin: viewing all subscribers

The React dashboard's **Subscriptions** tab shows all subscribers across
every service with their topic filters and last delivery timestamps.
Access via the basic-auth-protected dashboard URL (default
`http://localhost:3001/dashboard/`).

## Configuration

See [Configuration → APIs](/config) for the full `config.apis.*` block.
Each service supports its own `checkIntervalMin` to tune polling
frequency.
