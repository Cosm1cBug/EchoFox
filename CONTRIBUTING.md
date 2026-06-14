# Contributing to EchoFox

First — thank you for thinking of contributing. EchoFox is a small project and every PR matters.

By participating you agree to abide by responsible-collaboration norms (be kind, assume good faith, no harassment).

---

## Quick links

- 🐛 [Report a bug](https://github.com/Cosm1cBug/EchoFox/issues/new?template=bug.yml)
- ✨ [Request a feature](https://github.com/Cosm1cBug/EchoFox/issues/new?template=feature.yml)
- 🤖 [Request a command](https://github.com/Cosm1cBug/EchoFox/issues/new?template=command-request.yml)
- 💬 [Ask a question / discuss](https://github.com/Cosm1cBug/EchoFox/discussions)
- 🔐 [Report a vulnerability privately](./SECURITY.md)

---

## Development setup

```bash
git clone https://github.com/Cosm1cBug/EchoFox.git
cd EchoFox
npm install
cp src/config.example.js src/config.js   # then fill in admins[]
npm run dev
```

You'll need:

- **Node ≥ 20**
- **Python 3** and a C compiler (for `better-sqlite3`)
- A spare WhatsApp number for testing

---

## Code style

- 2-space indent, single quotes, semicolons (Prettier enforced — see `.prettierrc.json`)
- `eslint --max-warnings 0` must pass before PR merge
- Every new `.js` file needs the AGPL header — easy to add:

```bash
npm run headers
```

A pre-commit hook runs the above + `eslint --fix` automatically.

---

## Writing a command

The folder structure is `src/commands/<category>/<name>.js`. Categories are arbitrary — create a new one by just making a new folder.

### Minimal example

```js
/* AGPL-3.0 header */
'use strict';

module.exports = {
  name: 'echo',
  alias: ['e'],
  desc: 'Echoes whatever text you send',
  category: 'misc', // (optional — defaults to folder name)

  async start(sock, m, { ctx, args }) {
    if (!args.length) return ctx.reply('Usage: .echo <text>');
    await ctx.reply(`🔊 ${args.join(' ')}`);
  },
};
```

Save it, send `.echo hello world` — bot replies. **No restart needed** (hot-reload).

### The full command contract

| Field           | Type             | Required | Default     | Meaning                                                                                       |
| --------------- | ---------------- | -------- | ----------- | --------------------------------------------------------------------------------------------- |
| `name`          | string           | ✅       |             | Primary trigger word (lowercase)                                                              |
| `alias`         | string[]         |          | `[]`        | Alternative trigger words                                                                     |
| `desc`          | string           |          | `""`        | One-line description (shown in `.menu`)                                                       |
| `category`      | string           |          | folder name | Used to group in `.menu`                                                                      |
| `admin`         | boolean          |          | `false`     | Only admins (config.admins) can run                                                           |
| `group`         | boolean          |          | `false`     | Group chats only                                                                              |
| `needsMetadata` | boolean          |          | `false`     | Pre-fetch `metadata` arg for you                                                              |
| `requires`      | string[]         |          | `[]`        | Config paths that must be non-empty (e.g. `'apis.omdb.apiKey'`); auto-skip command if missing |
| `noLimit`       | boolean          |          | `false`     | Exempt from rate limiting                                                                     |
| `cooldown`      | number (seconds) |          | `0`         | Per-user delay between consecutive uses                                                       |
| `timeout`       | number (seconds) |          | `60`        | Per-invocation timeout                                                                        |
| `start`         | async function   | ✅       |             | The handler                                                                                   |

### Handler context

```js
async start(sock, m, ctx) { … }
```

- `sock` — the raw Baileys socket
- `m` — the raw Baileys message, with **legacy convenience fields glued on** (`m.sender`, `m.from`, `m.isGroup`, `m.isPrivate`, `m.reply`, `m.react`, `m.body`, `m.mtype`, `m.quoted`, `m.mentions`, …)
- `ctx` — handler context (see below)

| Key            | Meaning                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ctx.ctx`      | Clean parsed message (preferred for new code): `.id, .chat, .sender, .pushName, .timestamp, .isGroup, .isPrivate, .mtype, .body, .mentions, .quoted, .reply(), .react()` |
| `ctx.metadata` | Group metadata if `needsMetadata: true`, else `null`                                                                                                                     |
| `ctx.body`     | Raw message text                                                                                                                                                         |
| `ctx.args`     | Args after the command name (`['hello', 'world']`)                                                                                                                       |
| `ctx.arg`      | Same but lowercased                                                                                                                                                      |
| `ctx.text`     | `args.join(' ')`                                                                                                                                                         |
| `ctx.prefix`   | The prefix that matched (`.` or `$`)                                                                                                                                     |
| `ctx.command`  | This command's name                                                                                                                                                      |
| `ctx.commands` | The full `CommandRegistry`                                                                                                                                               |
| `ctx.config`   | Frozen config object                                                                                                                                                     |
| `ctx.logger`   | Pino child logger                                                                                                                                                        |
| `ctx.isAdmin`  | `true` if `m.sender` is in `config.admins`                                                                                                                               |

### Best practices

- **Use `ctx.reply()` instead of `sock.sendMessage(m.from, ...)`** — it auto-quotes.
- **Don't `console.log`** — use the `ctx.logger` so your output gets structured.
- **Validate inputs** before calling external APIs.
- **Don't worry about uncaught throws** — the runner reacts ❌, replies, and logs.
- **Add a `requires:` array** if you need API keys / channels — auto-skip if missing.
- **Add `cooldown:` to expensive commands** (image gen, downloads, etc.).

---

## Pull request checklist

Before opening a PR:

- [ ] `npm run lint` passes (or `npx eslint src --max-warnings 0`)
- [ ] `npm run headers:check` produces no diff
- [ ] `npm run test:contract` passes (no duplicate command names / alias collisions)
- [ ] `npm run docs:commands` regenerated if you added/changed a command
- [ ] You tested the change on a real WhatsApp pair-up
- [ ] You updated `CHANGELOG.md` under the `[Unreleased]` heading
- [ ] If you added a new command, you updated the table in `README.md`
- [ ] If you added a new config field, you updated `src/config.example.js` AND `src/lib/configSchema.js` AND the README config table

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(commands): add .joke command using JokeAPI
fix(messages): handle reaction messages without crashing
docs(readme): clarify Docker volume mounts
chore(deps): bump @whiskeysockets/baileys to 7.0.0-rc14
```

---

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 (the same license as the project). You retain copyright on your contributions.
