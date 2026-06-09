# Bot Settings

The `config.bot` block in `src/config.js` controls identity, prefix,
session management, locale, and public-mode policy.

```js
bot: {
  name:         'EchoFox',
  prefix:       '.',
  adminPrefix:  '$',
  sessionName:  '@session',
  timezone:     'Asia/Kolkata',
  language:     'en',
  public:       true,
},
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | `'EchoFox'` | Display name shown in help, menu, notifications |
| `prefix` | string | `'.'` | User command prefix |
| `adminPrefix` | string | `'$'` | Admin-only command prefix (admins gated via `config.admins`) |
| `sessionName` | string | `'@session'` | Subdirectory under auth path |
| `timezone` | IANA tz | `'Asia/Kolkata'` | Used for timestamp formatting in logs + replies |
| `language` | ISO 639-1 | `'en'` | Default locale for replies (per-group overrides via `groupSettings`) |
| `public` | boolean | `true` | If `false`, only admins (`config.admins`) can run commands |

## Public vs private mode

In public mode (default), any user can run commands. In private mode,
only JIDs listed in `config.admins` can. Useful for a personal bot
that you don't want others using.

```js
bot: { public: false },
admins: ['1234567890@s.whatsapp.net'],
```

## Prefix conflicts

If `prefix` and `adminPrefix` would BOTH match a message (e.g. they're
both single characters and the user types both), the admin prefix wins.
Non-admins who use `$` get "🔒 The `$` prefix is reserved for admins."

## Per-group prefix override

`config.groupSettings` supports per-group prefix:

```js
groupSettings: {
  '120363012345678901@g.us': {
    prefix: '!',          // this group uses ! instead of .
    public: false,        // and is admin-only despite global public:true
  },
},
```
