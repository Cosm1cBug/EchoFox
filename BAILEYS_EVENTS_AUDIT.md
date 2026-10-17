# Baileys 7.0.0-rc14 — Complete Event Map & EchoFox Coverage Audit

**Method:** Cloned `WhiskeySockets/Baileys` (master = `7.0.0-rc14`, byte-identical version pin
to EchoFox's `@whiskeysockets/baileys: 7.0.0-rc14`). Every field below is transcribed from
the authoritative source: `src/Types/Events.ts` (the `BaileysEventMap`) and the referenced
type files (`State.ts`, `Chat.ts`, `Contact.ts`, `GroupMetadata.ts`, `Message.ts`,
`Label.ts`, `LabelAssociation.ts`, `Call.ts`, `Auth.ts`) — then verified against the actual
`ev.emit(…)` call sites in `src/Socket/*` and `src/Utils/*` to confirm the runtime shape.
EchoFox status is verified against `src/core/worker.js` bindings, `src/events/*.js`
handlers, and the store-level `bind(ev)` in `src/store/sqliteStore.js`.

**The map contains exactly 34 events.** `sock.ev` emits nothing else (the `'event'` channel
is the internal buffered-emitter transport, not a public event).

---

## Scorecard

| Status                                                                | Count | Events                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Handled correctly                                                  | 14    | `connection.update`, `creds.update`, `messages.upsert`, `messages.delete`, `messages.reaction`, `message-receipt.update`, `blocklist.set`, `blocklist.update`, `chats.delete`, `presence.update`, `groups.update`, `groups.upsert`¹, `contacts.upsert`, `contacts.update` |
| ⚠️ Partial (some fields ignored, works)                               | 7     | `messages.update`, `chats.upsert`, `chats.update`, `messaging-history.status`, `newsletter.view`, `newsletter-participants.update`, `newsletter-settings.update`                                                                                                          |
| ❌ **Bound but silently broken (wrong payload shape → always no-op)** | **6** | `messaging-history.set`, `lid-mapping.update`, `labels.edit`, `labels.association`, `message-capping.update`, `newsletter.reaction`                                                                                                                                       |
| ❌ Broken sub-path                                                    | 1     | `call` (reject path OK; accept path passes a non-existent `offer` field)                                                                                                                                                                                                  |
| ⛔ Not bound at all                                                   | 5     | `messages.media-update`, `chats.lock`, `settings.update`, `group.join-request`, `group.member-tag.update`                                                                                                                                                                 |

¹ `groups.upsert` is consumed by `store.bind()` (metadata persist), not by the event router.

---

## 1. Connection & credentials

### `connection.update` → `Partial<ConnectionState>`

| Field                          | Type                                            | Meaning                                                                                                                                      |
| ------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection`                   | `'open' \| 'connecting' \| 'close'`             | Connection state machine. Fires MANY times with partial fields.                                                                              |
| `lastDisconnect`               | `{ error: Boom\|Error\|undefined, date: Date }` | What closed the last connection; `error.output.statusCode` drives the reconnect decision.                                                    |
| `isNewLogin`                   | `boolean?`                                      | True when this is a fresh pairing.                                                                                                           |
| `qr`                           | `string?`                                       | QR payload for pairing (render it yourself; `printQRInTerminal` is gone in v7).                                                              |
| `receivedPendingNotifications` | `boolean?`                                      | All offline push notifications have been delivered.                                                                                          |
| `legacy`                       | `{ phoneConnected: boolean, user?: Contact }?`  | Legacy connection options.                                                                                                                   |
| `isOnline`                     | `boolean?`                                      | Whether this client shows as online (if false, phone/other devices get the push).                                                            |
| `reachoutTimeLock`             | `ReachoutTimelockState?`                        | **v7 field:** `{ isActive?, timeEnforcementEnds?: Date, enforcementType? }` — while active, WhatsApp **blocks outgoing messages and calls**. |

**EchoFox** (`worker.js:400-443`): uses `connection`, `lastDisconnect`, `qr` (terminal QR for
QR-login) ✓. Ignores `isNewLogin`, `receivedPendingNotifications`, `isOnline`, `legacy`,
`reachoutTimeLock`. The missing `reachoutTimeLock` is the one with teeth: sends during an
active timelock will fail with no local explanation.
**Status: ✅ (core) / ⚠️ `reachoutTimeLock` unmonitored.**

### `creds.update` → `Partial<AuthenticationCreds>`

Fields (all of `SignalCreds` + `AuthenticationCreds`): `signedIdentityKey`, `signedPreKey`,
`registrationId`, `noiseKey`, `pairingEphemeralKeyPair`, `advSecretKey`, `me?` (own
Contact), `account?`, `signalIdentities?`, `myAppStateKeyId?`, `firstUnuploadedPreKeyId`,
`nextPreKeyId`, `lastAccountSyncTimestamp?`, `platform?`, `processedHistoryMessages`,
`accountSyncCounter`, `accountSettings`, `registered`, `pairingCode`, `lastPropHash`,
`routingInfo`, `additionalData?`. Signal keys rotate on ANY send/receive — must persist
immediately.

**EchoFox**: `sock.ev.on('creds.update', saveCreds)` ✓, custom key stores use
`BufferJSON` and a generic `${type}-${id}` scheme that transparently supports all v7
`SignalDataTypeMap` keys (`app-state-sync-key`, `app-state-sync-version`, `device-list`,
`identity-key`, `lid-mapping`, `pre-key`, `sender-key`, `sender-key-memory`, `session`,
`tctoken`) ✓.
**Status: ✅ Complete.**

---

## 2. History sync

### `messaging-history.set` → `{ chats, contacts, messages, lidPnMappings?, isLatest?, progress?, syncType?, pastParticipants?, chunkOrder?, peerDataRequestSessionId? }`

| Field                      | Type                                       | Meaning                                           |
| -------------------------- | ------------------------------------------ | ------------------------------------------------- |
| `chats`                    | `Chat[]`                                   | Chat metadata (reverse-chronological).            |
| `contacts`                 | `Contact[]`                                | Contacts seen in the sync.                        |
| `messages`                 | `WAMessage[]`                              | **The historical messages themselves.**           |
| `lidPnMappings`            | `LIDMapping[]?`                            | PN↔LID pairs learned from the sync.               |
| `isLatest`                 | `boolean?`                                 | Final chunk of the initial sync.                  |
| `progress`                 | `number\|null?`                            | 0–100 sync progress.                              |
| `syncType`                 | `proto.HistorySync.HistorySyncType\|null?` | Which sync phase (e.g. `ON_DEMAND` vs initial).   |
| `pastParticipants`         | `proto.IPastParticipants[]\|null?`         | Members who left these groups.                    |
| `chunkOrder`               | `number\|null?`                            | Chunk sequencing.                                 |
| `peerDataRequestSessionId` | `string\|null?`                            | PDO session that requested this (on-demand sync). |

**EchoFox** (`src/events/messaging-history.set.js`) — ❌ **BROKEN: the handler persists nothing.**

1. Its docblock claims _"the messages themselves arrive separately via messages.upsert
   with type='append' or 'prepend'"_ — **false**. Verified at the only emit site
   (`Utils/process-message.ts:410`): history messages are delivered **only** inside this
   event's `messages[]`. (`messages.upsert` types are `'append' | 'notify'` — there is no
   `'prepend'`, and backfill upserts are a _different_ channel.) The official data-store
   pattern persists messages from **both** events.
2. `store.saveChat?.(chat)` and `store.saveContact?.(contact)` — **neither method exists on
   any store** (grep-verified: the only references are these two call sites). The `?.`
   silently no-ops.
3. `lidPnMappings`, `pastParticipants`, `progress`, `syncType`, `chunkOrder` are ignored.

Net effect: after a restart/pairing, historical conversations never reach the DB → the
dashboard Chat history only shows messages seen live since boot, and `getMessage()` can't
serve retries for older messages. (Live `messages.upsert` + `store.bind()` cover going
forward.)

### `messaging-history.status` → `{ syncType, status: 'complete' \| 'paused', explicit: boolean }`

`explicit: false` ⇒ completion was inferred by timeout, not a server `progress: 100`.

**EchoFox**: logs the payload verbatim, persists nothing. Acceptable as a log-only hook,
but `status/explicit` are never used to gate "history ready" state.
**Status: ⚠️ trivial/OK.**

---

## 3. Chats & contacts

### `chats.upsert` → `Chat[]`

`Chat = proto.IConversation & { lastMessageRecvTimestamp? }`. Key fields: `id`, `name?`,
`unreadCount?`, `conversationTimestamp?`, `lastMessageRecvTimestamp?`, `archived?`,
`pinned?`, `mute?` (epoch ms or null), `markAsUnread?`, `status?`,
`ephemeralExpiration?`, `ephemeralSettingTimestamp?`, `disappearingMode?`,
`endOfHistoryTransferType?`, `transientBadging?`, `assignedLabel?` …

**EchoFox**: `store.bind()` persists `id/name/unreadCount/conversationTimestamp`
(`chatUpsert`); router handler persists `pinned/muted_until/archived` ✓. Ignores
`markAsUnread`, `ephemeral*`, `disappearingMode`, `status`, labels.
**Status: ✅ / ⚠️ cosmetic fields ignored.**

### `chats.update` → `ChatUpdate[]`

`ChatUpdate = Partial<Chat & { conditional: (bufferedData) => boolean|undefined; timestamp?: number }>`
— same fields as Chat, partially populated, plus a buffer-release `conditional` predicate.

**EchoFox**: only `pinned`, `mute`, `archived`. Notably **`unreadCount` and `name` changes
are dropped** (the dashboard "unread" badge goes stale until the next full upsert).
`conditional`/`timestamp` correctly ignored (buffer internals).
**Status: ⚠️ partial.**

### `chats.delete` → `string[]` (JIDs)

**EchoFox**: `store.markChatDeleted(jid)` (soft-delete, history retained) ✓.
**Status: ✅.**

### `chats.lock` → `{ id: string, locked: boolean }` — ⛔ **NOT BOUND.**

Marks a chat as locked (chat lock feature). No handler exists.

### `contacts.upsert` → `Contact[]`

| Field                   | Type           | Meaning                                                         |
| ----------------------- | -------------- | --------------------------------------------------------------- |
| `id`                    | `string`       | LID or PN JID (preferred form).                                 |
| `lid?` / `phoneNumber?` | `string?`      | The two addressing forms.                                       |
| `name?`                 | `string?`      | Name YOU saved.                                                 |
| `notify?`               | `string?`      | Their WhatsApp display name (push name).                        |
| `username?`             | `string?`      | WA username, when provided.                                     |
| `verifiedName?`         | `string?`      | Verified business name.                                         |
| `imgUrl?`               | `string\|null` | `'changed'` sentinel ⇒ re-fetch; `null` ⇒ no picture; else URL. |
| `status?`               | `string?`      | About/status text.                                              |

**EchoFox**: `store.bind()` persists `id/name/notify/imgUrl` (COALESCE upsert ✓);
router handler additionally persists `status`/`verifiedName` via `bulkUpsertContacts`.
⚠️ The `'changed'` sentinel can be written verbatim into `img_url` (the dashboard then
renders `src="changed"`), and `username/lid/phoneNumber` are dropped.
**Status: ✅ / ⚠️ sentinel + 3 fields ignored.**

### `contacts.update` → `Partial<Contact>[]`

**EchoFox**: `store.bind()` COALESCE-upserts `id/name/notify/imgUrl` ✓; router handler
invalidates `userDevicesCache` ✓. Good use of COALESCE so partials don't null out data.
**Status: ✅.**

### `lid-mapping.update` → `LIDMapping` = **`{ pn: string, lid: string }`**

Emitted from `NotificationLinkedProfilesUpdates` and `pnForLidChatAction` as exactly
`{ lid, pn }` (verified at both emit sites).

**EchoFox** (`src/events/lid-mapping.update.js`) — ❌ **BROKEN (silent no-op):**

```js
const lid = ev?.lid || ev?.lidJid;          // lid ✓ (lucky)
const jid = ev?.jid || ev?.whatsappJid;     // ✗ field is `pn`, not `jid`!
if (!lid || !jid) continue;                 // always continues
```

The PN field is **`pn`** — `jid`/`whatsappJid` don't exist on the payload. Every event is
skipped, so the `lid_mapping` table (and the dashboard's `/api/lid-mapping/:lid`) never
populates from events. (The _Signal_ store still receives mappings via Baileys' internal
`storeLIDPNMappings` → keyStore `lid-mapping` type, which EchoFox's generic key wrapper
handles ✓ — only the app-level table is starved.)

### Presence

### `presence.update` → `{ id: string, presences: { [participantJid]: PresenceData } }`

`PresenceData = { lastKnownPresence: 'unavailable'|'available'|'composing'|'recording'|'paused', lastSeen?: number, groupOnlineCount?: number }`.
`id` is the **chat** JID; `presences` maps **participant** JIDs.

**EchoFox**: iterates every entry (fixed from the old first-key bug), persists
`lastKnownPresence`/`lastSeen` keyed by participant with chat scope ✓. `groupOnlineCount`
ignored (fine).
**Status: ✅.**

---

## 4. Messages

### `messages.upsert` → `{ messages: WAMessage[], type: 'append' \| 'notify', requestId?: string }`

`'notify'` = live traffic; `'append'` = history/backfill (don't re-notify). `requestId` =
came from the phone via an on-demand request. Always iterate the full array.

`WAMessage = proto.IWebMessageInfo & { … }` — the big envelope. Notable fields: `key`
(`{remoteJid, fromMe, id, participant}` + Baileys extras `remoteJidAlt?`,
`remoteJidUsername?`, `participantAlt?`, `participantUsername?`, `server_id?`,
`addressingMode?`, `isViewOnce?}`), `message` (the `proto.IMessage` content — **can be
null**), `messageTimestamp`, `status` (1 sent / 2 delivered / 3 read / 4 played),
`participant`, `pushName`, `broadcast?`, `messageStubType?`, `messageStubParameters?`,
`labels?`, `userReceipt?`, `reactions?`, `pollUpdates?`, `ephemeralDuration?`,
`verifiedBizName?`, `messageSecret?`, `keepInChat?`, `pinInChat?`, `commentMetadata?`, …

**EchoFox** (`worker.js` gate + `messages.upsert.js` + `store.bind()`):

- Uses: `m.message` (unwrapped via `extractMessageContent`/`getContentType`, handles
  ephemeral/viewOnce wrappers), `key.remoteJid/id/fromMe/participant/participantAlt/
remoteJidAlt/addressingMode`, `pushName` (→ userDirectory), `messageTimestamp`,
  `contextInfo.quotedMessage` (quotes), media captions. Persist path filters non-human
  content (protocol/reactions/poll votes) and respects privacy exclusions ✓.
- The worker's backfill gate is timestamp-based rather than `type`-based (works, but
  `type: 'append'` would be the precise signal); `requestId` ignored.
- Ignored fields (all acceptable): `status`, `labels`, `userReceipt`, `reactions`,
  `broadcast`, `pollUpdates`, `keepInChat`, `pinInChat`, `verifiedBizName` … (receipts and
  reactions arrive via their own events).
  **Status: ✅ solid.**

### `messages.update` → `WAMessageUpdate[]` = `{ key: WAMessageKey, update: Partial<WAMessage> }[]`

`update` may carry `message` (edits arrive here, incl. `editedMessage`/`protocolMessage.
editedMessage` wrappers), `status` (numeric 1–4), `messageStubType` (REVOKE=68 ⇒ delete),
`pollUpdates` (poll votes — decryption needs `getMessage`), `starred`, `labels`,
`keepInChat`, `pinInChat`, `messageTimestamp`, …

**EchoFox**: edits ✓ (diff → `message_edits` + body overwrite), `status` progression ✓,
REVOKE stub → delete ✓. **`update.pollUpdates` is ignored** — poll votes are neither
recorded nor tallied (they're also filtered out of message storage as "non-human").
**Status: ⚠️ partial (pollUpdates gap).**

### `messages.delete` → `{ keys: WAMessageKey[] } \| { jid: string; all: true }`

**EchoFox**: both shapes ✓ (plus defensive normalisation), records `key.participant` as
deleter, optional ops-channel notice ✓.
**Status: ✅.**

### `messages.reaction` → `{ key: WAMessageKey, reaction: proto.IReaction }[]`

`IReaction = { key?: IMessageKey, text?: string, groupingKey?, senderTimestampMs?, unread? }`
— `text` falsey ⇒ reaction removed; `senderTimestampMs` is the reaction's own timestamp.

**EchoFox**: target key ✓, reactor from `reaction.key.participant/remoteJid` ✓, `text`
(removal → null) ✓, `senderTimestampMs` ✓. `groupingKey`/`unread` ignored (fine).
**Status: ✅.**

### `message-receipt.update` → `MessageUserReceiptUpdate[]` = `{ key: WAMessageKey; receipt: proto.IUserReceipt }[]`

`IUserReceipt = { userJid?, receiptTimestamp?, readTimestamp?, playedTimestamp?,
pendingDeviceJid?: string[], deliveredDeviceJid?: string[] }`.

**EchoFox**: derives delivered/read/played from the three timestamps ✓, records per-user
receipt + bumps aggregate message status ✓. Device fan-out lists ignored (fine).
**Status: ✅.**

### `messages.media-update` → `{ key: WAMessageKey; media?: { ciphertext: Uint8Array; iv: Uint8Array }; error?: Boom }[]` — ⛔ **NOT BOUND.**

Result of media re-upload requests (`reuploadRequest`). Matters when re-serving expired
media; nothing listens today.

---

## 5. Groups

### `groups.upsert` → `GroupMetadata[]` (you were added to these groups)

`GroupMetadata` fields: `id`, `notify?`, `addressingMode?` (`'pn'|'lid'`), `owner`,
`ownerPn?`, `ownerUsername?`, `owner_country_code?`, `subject`, `subjectOwner?`(+`Pn`,
`Username`), `subjectTime?`, `creation?`, `desc?`, `descOwner?`(+`Pn`,`Username`),
`descId?`, `descTime?`, `linkedParent?`, `restrict?`, `announce?`, `memberAddMode?`,
`joinApprovalMode?`, `isCommunity?`, `isCommunityAnnounce?`, `size?`,
`participants: GroupParticipant[]` (`Contact & { isAdmin?, isSuperAdmin?, admin? }`),
`ephemeralDuration?`, `inviteCode?`, `author?`(+`Pn`,`Username`).

**EchoFox**: `store.bind()` → `saveGroupMetadata` ✓ (no router handler — acceptable).
**Status: ✅ (metadata persist).**

### `groups.update` → `Partial<GroupMetadata>[]`

**EchoFox**: smart approach — snapshots old meta, **re-fetches authoritative
`groupMetadata(jid)`**, diffs via `groupSettingsEvents.diff()` and records change events
(with actor per field) ✓; merges the partial onto old meta on fetch failure ✓.
**Status: ✅ (better than field-scraping).**

### `group-participants.update` → `{ id, author, authorPn?, authorUsername?, participants: GroupParticipant[], action: 'add'|'remove'|'promote'|'demote'|'modify' }`

**EchoFox**: normalises v7 participant **objects** to `{id, phoneNumber, admin}` (fixed
earlier bug where objects hit a SQL bind), classifies self-leave vs kick, records events,
refreshes metadata, greeting service ✓. `authorPn`/`authorUsername` ignored (minor).
**Status: ✅.**

### `group.join-request` → `{ id, author, authorPn?, authorUsername?, participant, participantPn?, action: 'created'|'revoked'|'rejected', method: 'invite_link'|'linked_group_join'|'non_admin_add'|undefined }` — ⛔ **NOT BOUND.**

Join-request lifecycle for approval-mode groups. EchoFox has an `approve` command but no
real-time listener — pending requests are invisible until someone runs a command.

### `group.member-tag.update` → `{ groupId, participant, participantAlt?, label, messageTimestamp? }` — ⛔ **NOT BOUND.**

Participant label (member tagging) changes.

---

## 6. Blocklist

### `blocklist.set` → `{ blocklist: string[] }` — full snapshot. **EchoFox**: `setBlocklist` ✓.

### `blocklist.update` → `{ blocklist: string[], type: 'add' \| 'remove' }` — **EchoFox**: per-JID add/remove ✓.

**Status: ✅ both.**

---

## 7. Calls

### `call` → `WACallEvent[]`

`WACallEvent = { chatId, from, callerPn?, isGroup?, groupJid?, id, date: Date,
isVideo?, status: 'offer'|'ringing'|'preaccept'|'transport'|'relaylatency'|'timeout'|
'reject'|'accept'|'terminate', offline: boolean, latencyMs? }`
(There is **no `offer`/SDP field** — the event carries call _metadata_ only.)

**EchoFox** (`src/events/call.js` + `callManager` + internal `call.signaling`):

- antiCall reject path: `rejectCall(ev.id, ev.from)` + notice ✓ works.
- accept path: `callManager.handleOffer(ev.id, ev.from, **ev.offer**)` — ❌ **`u.offer` does
  not exist on `WACallEvent`** (verified against `Types/Call.ts` and the single emit site
  `messages-recv.ts:1840`). `handleOffer` passes it to
  `peer.setRemoteDescription(offer, 'offer')` → throws → caught as "Error handling
  incoming call". The accept flow can never receive an SDP from this event.
- `status` values other than `'offer'`, `offline`, `callerPn`, `isGroup`, `groupJid`,
  `date`, `latencyMs` are ignored; the custom JSON signaling bridge
  (`call.signaling` = EchoFox-internal event parsed from conversation JSON) handles
  `answer`/`ice-candidate` only — there is no path that delivers an offer SDP.
  **Status: ❌ accept path broken (field hallucination).**

---

## 8. Labels

### `labels.edit` → `Label` — **single object**, not an array

`Label = { id, name, color: number, deleted: boolean, predefinedId?: string }`.
Verified at the emit site (`Utils/chat-utils.ts:944`) and in `BaileysEventMap`.

**EchoFox** (`labels.edit.js`) — ❌ **BROKEN (silent no-op):**

```js
if (!Array.isArray(u) || !u.length) return;   // u is a single Label → always returns
for (const lbl of u) { … }
```

`labels.edit` is also NOT one of the bufferable events (no batching into arrays —
`BUFFERABLE_EVENT` list checked). Every label create/rename/delete is dropped.

### `labels.association` → `{ association: LabelAssociation; type: 'add' \| 'remove' }`

`LabelAssociation = ChatLabelAssociation` (`{ type: 'label_jid', chatId, labelId }`)
`| MessageLabelAssociation` (`{ type: 'label_message', chatId, messageId, labelId }`).
Note the wrapper: `type`/`labelId` live **inside `association`** for identity;
outer `type` is add/remove. Verified at `chat-utils.ts:952`.

**EchoFox** (`labels.association.js`) — ❌ **BROKEN (silent no-op), three mismatches:**

1. `if (!ev?.association || !ev.type || !ev.labelId) return;` — `ev.labelId` doesn't exist
   at top level (it's `ev.association.labelId`) → always returns.
2. Reads `a.chatJid || a.jid` — the real field is **`a.chatId`**.
3. Derives target type from `a.type` expecting `'chat'|'message'` — real values are
   **`'label_jid'` / `'label_message'`** (`LabelAssociationType` enum).

---

## 9. Newsletters (channels)

### `newsletter.reaction` → `{ id, server_id, reaction: { code?, count?, removed? } }`

**Singular `reaction` object.** Verified at `messages-recv.ts:458` (`{ id, server_id,
reaction: { code, count: 1 } }`).

**EchoFox** (`newsletter.reaction.js`) — ❌ **BROKEN (silent no-op):**

```js
const reactions = ev?.reactions || [];   // ✗ payload field is `reaction` (object)
for (const r of reactions) { … }         // always iterates zero items
```

Also `messageId = ev?.server_id || ev?.messageId || ev?.id` — the `ev.id` fallback would
use the _newsletter_ id as a message id (wrong), and `reaction.removed` (undo) is never
mapped.

### `newsletter.view` → `{ id, server_id, count: number }`

`count` is parsed from the notification content (view counter value).

**EchoFox**: increments views by **1** per event and ignores `count` — if `count` is the
server's cumulative/absolute value, the local tally drifts.
**Status: ⚠️ partial.**

### `newsletter-participants.update` → `{ id, author, user, new_role, action: string }`

**EchoFox**: logs + throttled (1 h) metadata refresh via `sock.newsletterMetadata` ✓; the
individual `user/author/new_role/action` fields are not recorded as events.
**Status: ⚠️ partial.**

### `newsletter-settings.update` → `{ id, update: any }`

**EchoFox**: strips id keys and stores the remainder (`{ update: … }` blob) via
`updateNewsletterSettings` ✓-ish (shape depends on store; nothing reads the `update`
wrapper back except `getNewsletterSettings().settings`).
**Status: ⚠️ partial.**

---

## 10. Quota / capping

### `message-capping.update` → `NewChatMessageCapInfo`

Fields (verified at `messages-recv.ts:350`, emitted raw from MEX
`xwa2_notify_new_chat_messages_capping_info_update`):

| Field                                             | Type                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `total_quota?`                                    | `number`                                                                       |
| `used_quota?`                                     | `number`                                                                       |
| `cycle_start_timestamp?` / `cycle_end_timestamp?` | `string`                                                                       |
| `server_sent_timestamp?`                          | `string`                                                                       |
| `ote_status?`                                     | `NewChatMessageCappingOTEStatusType`                                           |
| `mv_status?`                                      | `NewChatMessageCappingMVStatusType`                                            |
| `capping_status?`                                 | `NewChatMessageCappingStatusType` (`NONE/FIRST_WARNING/SECOND_WARNING/CAPPED`) |

This is WhatsApp's **"new chat" messaging quota** — account-level, not per-chat.

**EchoFox** (`message-capping.update.js`) — ❌ **BROKEN (silent no-op):**
expects `ev.jid || ev.chatJid` and `ev.cap_value ?? ev.cap ?? ev.maxMessages` — **none of
those fields exist**. Every event is skipped.

---

## 11. Settings sync

### `settings.update` — discriminated union — ⛔ **NOT BOUND.**

| `setting`                            | `value`                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| `unarchiveChats`                     | `boolean`                                                                             |
| `locale`                             | `string`                                                                              |
| `disableLinkPreviews`                | `proto.SyncActionValue.IPrivacySettingDisableLinkPreviewsAction`                      |
| `timeFormat`                         | `proto.SyncActionValue.ITimeFormatAction`                                             |
| `privacySettingRelayAllCalls`        | `proto.SyncActionValue.IPrivacySettingRelayAllCalls`                                  |
| `statusPrivacy`                      | `proto.SyncActionValue.IStatusPrivacyAction`                                          |
| `notificationActivitySetting`        | `proto.SyncActionValue.NotificationActivitySettingAction.NotificationActivitySetting` |
| `channelsPersonalisedRecommendation` | `proto.SyncActionValue.IPrivacySettingChannelsPersonalisedRecommendationAction`       |

Account-level WhatsApp settings syncs (from app-state). Nothing consumes these today —
low urgency for a bot, but `unarchiveChats`/`locale` are cheap to persist if the dashboard
ever shows account settings.

---

## 12. Consolidated bug list (new, from this audit)

| #   | Event                                                                                                        | Failure mode                                      | Root cause                                                                                                           | Fix                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | `messaging-history.set`                                                                                      | **Nothing persisted** (messages, chats, contacts) | False premise "messages arrive via messages.upsert"; `saveChat`/`saveContact` don't exist                            | Persist `messages[]` (batch insert), implement `saveChat`/`saveContact` (or route into `updateChat`/`bulkUpsertContacts`), optionally store `lidPnMappings` → `setLidMapping` |
| E2  | `lid-mapping.update`                                                                                         | Always no-op                                      | Reads `ev.jid`/`ev.whatsappJid`; real field is **`ev.pn`**                                                           | `const jid = ev?.pn \|\| ev?.jid \|\| …`                                                                                                                                      |
| E3  | `labels.edit`                                                                                                | Always no-op                                      | Handler requires an array; payload is a **single `Label`**                                                           | `const list = Array.isArray(u) ? u : [u]`                                                                                                                                     |
| E4  | `labels.association`                                                                                         | Always no-op                                      | `ev.labelId` should be `ev.association.labelId`; `a.chatJid` → `a.chatId`; `a.type` is `'label_jid'/'label_message'` | Rewrite `processOne` against the real shape                                                                                                                                   |
| E5  | `message-capping.update`                                                                                     | Always no-op                                      | Expects `jid`+`cap_value`; payload is quota info (`total_quota`/`used_quota`/`capping_status`)                       | Store the quota fields (rename `setMessageCap` or map fields)                                                                                                                 |
| E6  | `newsletter.reaction`                                                                                        | Always no-op                                      | Reads `ev.reactions[]`; payload has singular `reaction` object                                                       | Iterate `[ev.reaction]`, handle `removed`                                                                                                                                     |
| E7  | `call` accept path                                                                                           | `setRemoteDescription(undefined)`                 | Passes `ev.offer` — no such field on `WACallEvent`                                                                   | Redesign signaling (offer SDP must arrive via the custom signaling channel or `call.signaling` must transport it); reject path is fine                                        |
| E8  | `newsletter.view`                                                                                            | Counts drift                                      | `count` field ignored                                                                                                | Use `count` (or document +1 semantics)                                                                                                                                        |
| E9  | ⛔ `messages.media-update`, `chats.lock`, `settings.update`, `group.join-request`, `group.member-tag.update` | Unobserved                                        | Never bound                                                                                                          | Bind as needed — `group.join-request` is the highest-value one for a group-management bot                                                                                     |

---

## 13. Per-event field coverage matrix (compact)

| Event                            | Payload fields                                                                                                                 | Used by EchoFox                                         | Ignored                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `connection.update`              | connection, lastDisconnect, isNewLogin, qr, receivedPendingNotifications, legacy, isOnline, reachoutTimeLock                   | connection, lastDisconnect, qr                          | isNewLogin, receivedPendingNotifications, legacy, isOnline, **reachoutTimeLock** |
| `creds.update`                   | (all AuthenticationCreds)                                                                                                      | all (saveCreds)                                         | —                                                                                |
| `messaging-history.set`          | chats, contacts, messages, lidPnMappings, isLatest, progress, syncType, pastParticipants, chunkOrder, peerDataRequestSessionId | isLatest (log only)                                     | **everything else (E1)**                                                         |
| `messaging-history.status`       | syncType, status, explicit                                                                                                     | (logged)                                                | —                                                                                |
| `chats.upsert`                   | Chat[] (id, name, unreadCount, conversationTimestamp, pinned, mute, archived, …)                                               | id, name, unreadCount, ts, pinned, mute, archived       | markAsUnread, ephemeral*, status                                                 |
| `chats.update`                   | same, partial                                                                                                                  | pinned, mute, archived                                  | name, unreadCount, ts, ephemeral*                                                |
| `chats.delete`                   | string[]                                                                                                                       | all                                                     | —                                                                                |
| `chats.lock`                     | id, locked                                                                                                                     | —                                                       | **all (unbound)**                                                                |
| `contacts.upsert`                | id, lid, phoneNumber, name, notify, username, verifiedName, imgUrl, status                                                     | id, name, notify, imgUrl, status, verifiedName          | lid, phoneNumber, username; ⚠️ `'changed'` sentinel                              |
| `contacts.update`                | (Partial<Contact>)                                                                                                             | id, name, notify, imgUrl                                | username etc.                                                                    |
| `lid-mapping.update`             | **pn**, lid                                                                                                                    | lid only                                                | **pn — bug E2**                                                                  |
| `presence.update`                | id, presences{participant: lastKnownPresence, lastSeen, groupOnlineCount}                                                      | id, participant, lastKnownPresence, lastSeen            | groupOnlineCount                                                                 |
| `messages.upsert`                | messages(WAMessage), type, requestId                                                                                           | key.*, message, messageTimestamp, pushName, contextInfo | type, requestId, status, labels, pollUpdates…                                    |
| `messages.update`                | key, update{message, status, messageStubType, pollUpdates, …}                                                                  | message(edits), status, messageStubType(REVOKE)         | **pollUpdates**, starred, labels, keepInChat, pinInChat                          |
| `messages.delete`                | keys[] \| {jid, all}                                                                                                           | both shapes                                             | —                                                                                |
| `messages.reaction`              | key, reaction{key, text, groupingKey, senderTimestampMs, unread}                                                               | key, reaction.key, text, senderTimestampMs              | groupingKey, unread                                                              |
| `message-receipt.update`         | key, receipt{userJid, receipt/read/playedTimestamp, pending/deliveredDeviceJid}                                                | userJid, 3 timestamps                                   | device lists                                                                     |
| `messages.media-update`          | key, media{ciphertext, iv}, error                                                                                              | —                                                       | **all (unbound)**                                                                |
| `groups.upsert`                  | GroupMetadata[]                                                                                                                | meta (store.bind)                                       | —                                                                                |
| `groups.update`                  | Partial<GroupMetadata>[]                                                                                                       | all (via refetch+diff)                                  | —                                                                                |
| `group-participants.update`      | id, author, authorPn, authorUsername, participants[], action                                                                   | id, author, participants(id/phoneNumber/admin), action  | authorPn, authorUsername                                                         |
| `group.join-request`             | id, author*, participant*, action, method                                                                                      | —                                                       | **all (unbound)**                                                                |
| `group.member-tag.update`        | groupId, participant, participantAlt, label, messageTimestamp                                                                  | —                                                       | **all (unbound)**                                                                |
| `blocklist.set`                  | blocklist                                                                                                                      | all                                                     | —                                                                                |
| `blocklist.update`               | blocklist, type                                                                                                                | all                                                     | —                                                                                |
| `call`                           | WACallEvent[] (chatId, from, callerPn, isGroup, groupJid, id, date, isVideo, status, offline, latencyMs)                       | id, from, isVideo, status('offer')                      | **ev.offer (doesn't exist — E7)**, offline, callerPn, others                     |
| `labels.edit`                    | Label (single)                                                                                                                 | —                                                       | **all — bug E3**                                                                 |
| `labels.association`             | {type, association{type, chatId, messageId?, labelId}}                                                                         | —                                                       | **all — bug E4**                                                                 |
| `newsletter.reaction`            | id, server_id, reaction{code, count, removed}                                                                                  | id(server_id as msgId fallback)                         | **reaction — bug E6**                                                            |
| `newsletter.view`                | id, server_id, count                                                                                                           | id, server_id                                           | **count — E8**                                                                   |
| `newsletter-participants.update` | id, author, user, new_role, action                                                                                             | id (refresh)                                            | author, user, new_role, action                                                   |
| `newsletter-settings.update`     | id, update                                                                                                                     | id, update (blob)                                       | —                                                                                |
| `message-capping.update`         | total_quota, used_quota, cycle_*, server_sent_timestamp, ote_status, mv_status, capping_status                                 | —                                                       | **all — bug E5**                                                                 |
| `settings.update`                | union (8 settings)                                                                                                             | —                                                       | **all (unbound)**                                                                |
