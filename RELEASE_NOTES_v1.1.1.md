# EchoFox v1.1.1 — Security + multi-provider TTS 🔒🎤

A security-focused hotfix release that also delivers a much-needed
upgrade to the text-to-speech engine. Vulnerability count drops from
**14 → 2** (the remaining 2 are upstream in Baileys), and `.tts`
gets a major quality bump via Microsoft Edge's free neural voices.

## TL;DR

- 🔒 **12 transitive CVEs eliminated** (only Baileys' 2 remain — upstream)
- 🎤 **Multi-provider TTS** — Edge (default), Google, Piper, Coqui — config-switchable
- 🩹 **Fixed pending crash** in call handler (missing `node-datachannel` dep)
- ⏰ **node-cron v4** — fixes 1 transitive CVE, API unchanged for our usage
- 🚫 **`node-gtts` removed entirely** — wiped 6 CVEs in one stroke

## Upgrade from v1.1.0

```bash
git pull
rm package-lock.json
rm -rf node_modules        # required — removes node-gtts cruft
npm install
npm start
```
