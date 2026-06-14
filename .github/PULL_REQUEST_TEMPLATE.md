<!--
  Thanks for opening a PR! Please fill out the checklist below.
  Small / docs-only PRs can skip irrelevant items.
-->

## What does this PR do?

<!-- A 1-3 sentence summary. -->

## Related issue(s)

<!-- "Closes #123" or "Refs #45" -->

## Type of change

- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] 💥 Breaking change (fix or feature that changes existing behavior)
- [ ] 🤖 New command
- [ ] 📚 Documentation only
- [ ] 🔧 Tooling / CI / build
- [ ] 🧹 Refactor / cleanup (no functional change)

## Checklist

- [ ] I have read [CONTRIBUTING.md](../CONTRIBUTING.md).
- [ ] `npm run lint` passes with zero warnings.
- [ ] `npm run headers:check` passes (every new `.js` has an AGPL header).
- [ ] I tested this on a real WhatsApp pair-up (or N/A — explain below).
- [ ] I updated `CHANGELOG.md` under the `[Unreleased]` heading.
- [ ] If I added a new config field, I updated `src/config.example.js`,
      `src/lib/configSchema.js`, and the config table in `README.md`.
- [ ] If I added a new command, I updated the commands table in `README.md`.
- [ ] If I changed the message handler or store, I tested `.ping`, `.menu`,
      and at least one media command.
- [ ] My commits follow [Conventional Commits](https://www.conventionalcommits.org/)
      (`feat:`, `fix:`, `docs:`, `chore:`, etc.).

## Testing notes

<!--
  How can a reviewer verify this works?
  Include screenshots / log snippets for behavior changes.
-->

## Additional context

<!-- Anything else reviewers should know. -->
