# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in EchoFox, **please do not open a public GitHub issue.** Instead, report it privately so we can fix it before it's exploited.

### How to report

- **Email:** [cosmicbug.me@pm.me](mailto:cosmicbug.me@pm.me)
- **GitHub Security Advisories:** [Open a draft advisory](https://github.com/Cosm1cBug/EchoFox/security/advisories/new) (preferred — encrypted, gives you a CVE)

### What to include

To help us triage quickly, please include:

1. **Description** of the vulnerability and its potential impact
2. **Steps to reproduce** (proof-of-concept code if applicable)
3. **EchoFox version** and Baileys version
4. **Your environment** (OS, Node version, deployment method)
5. **Suggested fix**, if you have one
6. **Whether you'd like credit** in the advisory (and what name/handle to use)

### What to expect

| Timeline        | Action                                                    |
| --------------- | --------------------------------------------------------- |
| Within 48 hours | Acknowledgement of receipt                                |
| Within 7 days   | Initial assessment and triage severity                    |
| Within 30 days  | Patch released (for critical/high) or mitigation guidance |
| After fix       | Public advisory + CVE if applicable                       |

We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure): please give us a reasonable time to fix the issue before publishing details.

---

## Supported Versions

| Version                              | Supported                           |
| ------------------------------------ | ----------------------------------- |
| 1.x (latest)                         | ✅                                  |
| 0.x (alpha/beta pre-releases)        | ⚠️ best-effort, upgrade recommended |
| Original 6.x architecture (pre-fork) | ❌ no support                       |

---

## Scope

In scope for this policy:

- The EchoFox application code (everything in this repository)
- Default configuration that could lead to RCE, credential leakage, or auth bypass
- Anything in our published Docker image (`ghcr.io/cosm1cbug/echofox`, `cosm1cbug/echofox` on Docker Hub)
- Anything in our published npm package (`echofox`)

Out of scope:

- Vulnerabilities in upstream [Baileys](https://github.com/WhiskeySockets/Baileys) — please report those directly to the Baileys maintainers
- Vulnerabilities in WhatsApp itself — report to [Meta Bug Bounty](https://www.facebook.com/whitehat/)
- Social engineering, phishing, physical attacks
- Issues that require an already-compromised host machine
- Denial of service from very high message volume (you control the rate)

---

## Known accepted-risk advisories

`npm audit` will report a small number of advisories that originate from
deep transitive dependencies we cannot fix without breaking changes
upstream. Each one is reviewed and accepted with a rationale below.
Re-evaluated on every release.

| Advisory                                                                 | Package                  | Path                                        | Status             | Rationale                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------ | ------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-4gp8-rjrq-ch6q](https://github.com/advisories/GHSA-4gp8-rjrq-ch6q) | `link-preview-js` ≤4.0.0 | `@whiskeysockets/baileys → link-preview-js` | Mitigated app-side | Baileys uses this for link previews. Our v1.5.0 SSRF hardening (`src/services/ai/toolRegistry.js`) covers the IPv6/loopback SSRF concern for our own code paths. Bot does not call link-preview-js directly. Waiting for upstream Baileys to bump. |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | `esbuild` ≤0.28.0        | `vitepress → vite → esbuild`                | Dev-only           | Dev-server only. Only used at `npm run docs:build` time inside the GitHub Actions runner. Not present at runtime, not in Docker image, not in npm package. Waiting for vitepress 2 to land a newer vite.                                           |
| [GHSA-gv7w-rqvm-qjhr](https://github.com/advisories/GHSA-gv7w-rqvm-qjhr) | `esbuild` ≤0.28.0        | same as above                               | Dev-only           | Same as above.                                                                                                                                                                                                                                     |

If you find a way to mitigate any of these properly please open a
private security advisory or PR — happy to upgrade.

### How to re-check

```bash
npm audit
# Anything outside the table above is a regression — please report.
```

---

## Recognition

We thank everyone who responsibly discloses security issues to us. With your permission, we'll add your name to the [Security Hall of Fame](https://github.com/Cosm1cBug/EchoFox/blob/main/SECURITY.md#hall-of-fame) below.

### Hall of Fame

_Nobody yet — be the first!_
