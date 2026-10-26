# Try the three menu styles

The command lives in `src/commands/main/menu.js`. Type `.menu` for the style chooser, then try these individually in WhatsApp:

| Command           | What it sends                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `.menu carousel`  | A native interactive carousel containing **exactly one card**, the existing EchoFox image, and a category selector. |
| `.menu thumbnail` | A normal image with a caption listing category commands. No buttons or ad/link-preview tricks.                      |
| `.menu list`      | A native-flow `single_select` category picker with a text header. No image upload.                                  |

Replace `.` with your configured prefix. The same commands work in DMs (including LID-addressed DMs) and groups. No configuration changes, extra credentials or new dependencies are needed. If the bot was already running, the existing command-file watcher normally reloads the menu; restart if your environment does not support that watcher. The message-handler change also requires a worker restart when first installing this update.

## Navigation

All styles share the same registered commands and permission-aware catalogue:

```text
.menu tools
.menu media
.menu ai
.menu feeds
.menu user
.menu group
.menu admin
.menu all
.menu all 2
```

The group category only appears in groups; bot-administration entries require the configured-admin permission. Hidden, disabled, missing-configuration, and globally disabled YouTube-download commands are omitted. AI generation commands are omitted while AI is globally disabled, but `.ai` remains discoverable for status. Command handlers remain responsible for their own group-admin, consent, provider, privacy and budget checks; listing a command is not authorization to run it.

Keep the preview name when navigating if you want the Back link to return to the same style:

```text
.menu carousel tools
.menu thumbnail tools
.menu list tools
.menu list tools 2
```

Category and full-command replies are plain text, alphabetically sorted and paginated eight commands at a time. Native selections navigate the menu only; they never execute the selected feature or call an AI provider.

The existing `.listmenu` alias is retained, and `.commands` also opens the style chooser. `.menu help` displays usage. There is no new standalone `.help` command.

## Image and branding

Both image variants use the existing local asset:

```text
src/Utils/assets/buggy.jpg
```

The file path is resolved relative to the command, not the launch directory. The image is read lazily and cached; restart/reload the menu after replacing it. A missing image produces a text-only card or text reply. The displayed bot name comes from configuration and the version from `package.json`. No sender phone number/LID, personal-contact URL, forwarded-newsletter attribution or fake business identity is added.

## What to check on your phone

1. Open `.menu thumbnail`: confirm the image and caption render, then type one category command.
2. Open `.menu list`: tap **Browse commands**, select a category and verify the command page arrives.
3. Open `.menu carousel`: confirm there is **one** card, and try its category picker.
4. Repeat in a group and, if possible, WhatsApp Web/Desktop. Confirm group/admin visibility matches your role.
5. Try `.menu all 2` and follow the Previous/Next commands.

Single-card carousels and native-flow controls are experimental on the pinned Baileys 7 release. Some WhatsApp clients may reject or hide them even when the protocol send succeeds. The carousel intentionally stays at one card for this comparison; it does not silently change into a multi-card carousel.

Delivery/upload errors are logged and fall back to the same category overview as text. A successful relay cannot reveal whether the receiving client rendered the controls, so typed navigation stays in the payload; use `.menu thumbnail` or `.menu all` if the interactive message is invisible. These variants have automated payload/routing tests, not a live WhatsApp rendering certification.

## Installation note

This update also adds `src/lib/menuNavigation.js` and updates native-response extraction in `src/events/messages.upsert.js`. Copy those changes too if transferring the menu manually; copying only `menu.js` is insufficient for selection handling. The upload-timeout fix additionally requires the current `src/lib/network.js`, `src/lib/configSchema.js`, and the `fetchAgent` change in `src/core/worker.js`. The example configuration documents the new setting; do not overwrite your private config with the example. Restart the worker after installing them. Normal prefix, rate-limit, privacy, public-mode and admin checks still run on selections.

## Upload timeouts

The image menus explicitly pass `network.mediaUploadTimeoutMs` (default `30000` ms) to Baileys. The worker also installs a dedicated media agent with that inactivity timeout, so ordinary media commands and link-preview uploads do not inherit Node's short global-agent timeout. See [media timeout configuration](../config.md#whatsapp-media-upload-timeout) for environment overrides, proxy/CA behavior and limits.

This is a per-host inactivity timeout, not a total upload/command deadline. It does not change carousel client support, cancel background work, or make blocked CDN routes reachable. Existing command deadlines remain unchanged. Upload failures still log a warning and fall back to text. The earlier menu-only review ZIP does not contain this later shared-transport fix.
