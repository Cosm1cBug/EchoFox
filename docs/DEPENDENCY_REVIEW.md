# Dependency review — 2026-10-22

This is a local audit/compatibility record for the unreleased remediation, **not** a declaration that dependencies are safe or a license review.

## Production audit findings

`npm run audit:production` completed for root and dashboard against the configured npm registry:

| Project   | Critical/high | Moderate | Total |
| --------- | ------------- | -------- | ----- |
| Root      | 0             | 2        | 2     |
| Dashboard | 0             | 0        | 0     |

The root findings are `wa-sticker-formatter@4.4.4` and its `file-type@16.5.4` dependency, representing the same underlying [ASF parser infinite-loop advisory (GHSA-5v7r-6r5c-r473)](https://github.com/advisories/GHSA-5v7r-6r5c-r473). Registry-reported affected `file-type` range is `>=13.0.0 <21.3.1`. Other root branches use `file-type@21.3.4` via Jimp/music-metadata, but that does **not** replace the formatter's private 16.x copy.

Raw `npm audit --omit=dev --json` exits **1** for these moderate findings. The existing declared production gate is high/critical and therefore passes after validating the report. Malformed/unavailable/error reports still fail. Do not describe this result as a zero-findings audit.

## Targeted mitigation, not a dependency fix

A shared `stickerInput` guard now rejects **ASF/WMV input before formatter construction** in both the main-thread sticker command and the media worker. It matches the vulnerable detector's actual ten-byte probe (not just a valid full GUID), rejects path/URL strings, preserves binary-view offsets and enforces the existing 8 MiB sticker limit at the worker boundary too. Tests include malformed zero-sized ASF headers, binary views, the command process and real media-worker IPC.

The package/advisory remains present and the audit findings are **not suppressed**. This guard mitigates the known entry path; it is not a proof of all media parser safety or event-loop cancellation. Future formatter callers must use the same boundary. Replace/upgrade the legacy parser and test ordinary image, animated video/WebP, metadata and malformed-media behavior before calling F20 complete.

npm proposes changing `wa-sticker-formatter` to **1.6.0**, marked `isSemVerMajor=true`. That is a breaking downgrade, not an automatically safe remediation. No `npm audit fix --force`, blanket `file-type` override, or unreviewed migration was run. The modern file-type API is not a drop-in replacement for the formatter's legacy `fromBuffer` API.

## Lifecycle/compatibility warnings still open

Observed install warnings include:

- `recharts@2.15.4`: 1.x/2.x no longer active; a v3 migration needs component/type/render validation.
- `@distube/ytdl-core@4.16.12`: 4.x unsupported; v5 migration needs real download/caller compatibility testing.
- `fluent-ffmpeg@2.1.3`: no longer supported.
- `prebuild-install@7.1.3`: no longer maintained; native addon build paths need review.
- `prom-client@15.1.3`: replacement named `@prometheus-io/client`; exporter/registry/label compatibility needs review before migration.

These are not fixed by the audit's severity threshold. Native SQLite was explicitly rebuilt and smoke-tested on Node 22.22.3 using local Node headers. Setup/clean artifact installations used `--ignore-scripts` before that targeted rebuild; they do **not** certify the other native addon install paths, a full WhatsApp connection or container builds. Docker and promtool are unavailable in this environment.

The added direct `ipaddr.js` dependency is narrowly used for canonical IP/range classification; its lockfile is updated. Existing unrelated overrides were not force-upgraded.

## Next acceptance work

1. Review and migrate/replace the legacy formatter dependency; remove the advisory rather than hiding it.
2. Run benign and hostile media conversions with bounded execution, ffmpeg/sharp/native versions recorded.
3. Review deprecated/EOL packages individually; test lifecycle scripts on supported OS/architectures and the actual deployment image.
4. Re-run root/dashboard production and development-tool audits, plus license/provenance review, before an owner-authorized release.
