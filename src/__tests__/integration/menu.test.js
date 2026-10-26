/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { proto } = require('@whiskeysockets/baileys');
const { makeMockSock, makeMockMessage, makeMockStore } = require('../helpers/mockSock');
const {
  MENU_STYLES,
  MENU_CATEGORIES,
  makeMenuSelection,
  readMenuSelection,
  readNativeMenuResponse,
} = require('../../lib/menuNavigation');
const metrics = require('../../services/metrics');
const { version } = require('../../../package.json');

metrics.init(makeMockStore());

function registry(items) {
  return { all: () => items };
}

function fixtureCommands() {
  return [
    { name: 'menu', hidden: true, category: 'main' },
    { name: 'sticker', category: 'convert', desc: 'Make a sticker.', usage: '(reply to media)' },
    { name: 'toimg', category: 'convert', desc: 'Convert a sticker to an image.' },
    { name: 'qr', category: 'tools', desc: 'Create a QR code.' },
    { name: 'ping', category: 'misc', desc: 'Check responsiveness.' },
    { name: 'rss', type: 'general', desc: 'Subscribe to feeds.' },
    { name: 'ai', category: 'general', desc: 'Check AI settings.' },
    { name: 'ask', category: 'general', desc: 'Ask AI.' },
    { name: 'profile', category: 'user', desc: 'Your profile.' },
    { name: 'warn', category: 'group', group: true, desc: 'Warn a member.' },
    { name: 'serverinfo', category: 'admin', admin: true, desc: 'Operator diagnostics.' },
    { name: 'oldadmin', type: 'admin', desc: 'Legacy admin metadata.' },
    { name: 'secret', hidden: true, category: 'misc' },
    { name: 'exec', type: 'hide', admin: true, category: 'misc' },
    { name: 'disabled', disabled: true, category: 'tools' },
    { name: 'virustotal', category: 'general', requires: ['apis.virustotal.apiKey'] },
    { name: 'ytdl', category: 'download' },
  ];
}

function setup(overrides = {}) {
  const sock = makeMockSock();
  sock.relayed = [];
  sock.uploads = [];
  sock.relayMessage = async (jid, message, options) => {
    sock.relayed.push({ jid, message, options });
  };
  // Real Baileys media preparation + protobuf encoding, but NO network upload.
  sock.waUploadToServer = async (...args) => {
    sock.uploads.push(args);
    return { mediaUrl: 'https://example.invalid/menu.jpg', directPath: '/menu/test' };
  };
  const m = makeMockMessage({ jid: overrides.jid || '70000000001@lid', text: '.menu' });
  const ctx = {
    chat: m.key.remoteJid,
    sender: m.key.remoteJid,
    isGroup: m.key.remoteJid.endsWith('@g.us'),
    reply: (text) => sock.sendMessage(m.key.remoteJid, { text }, { quoted: m }),
  };
  const cfg = {
    bot: { name: 'EchoFox', prefix: '.', adminPrefix: '$' },
    ai: { enabled: true },
    features: { ytdl: false },
    apis: { virustotal: { apiKey: '' } },
    ...overrides.config,
  };
  const commandPath = require.resolve('../../commands/main/menu');
  delete require.cache[commandPath];
  const menu = require(commandPath);
  const run = (args, more = {}) =>
    menu.start(sock, m, {
      ctx,
      commands: registry(fixtureCommands()),
      args,
      prefix: '.',
      config: cfg,
      isAdmin: false,
      logger: sock.logger,
      ...more,
    });
  return { sock, m, ctx, cfg, menu, run };
}

function interactive(sock) {
  const record = sock.relayed.at(-1);
  assert.ok(record, 'interactive message was not relayed');
  // Round-trip the ACTUAL protobuf to catch wrong field types/oneof placement.
  const wire = proto.Message.decode(proto.Message.encode(record.message).finish());
  return wire.viewOnceMessage.message.interactiveMessage;
}

function rowsFor(message) {
  const buttons = message.nativeFlowMessage.buttons;
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].name, 'single_select');
  assert.equal(typeof buttons[0].buttonParamsJson, 'string');
  return JSON.parse(buttons[0].buttonParamsJson).sections.flatMap((section) => section.rows);
}

test('menu import and style chooser perform no thumbnail reads or uploads', async (t) => {
  const read = t.mock.method(fs, 'readFile', async () => assert.fail('unexpected image read'));
  const { sock, run } = setup();
  await run([]);
  assert.match(sock.lastSent.content.text, /\.menu carousel/);
  assert.match(sock.lastSent.content.text, /\.menu thumbnail/);
  assert.match(sock.lastSent.content.text, /\.menu list/);
  assert.equal(read.mock.callCount(), 0);
  assert.equal(sock.uploads.length, 0);
  assert.equal(sock.relayed.length, 0);
});

test('thumbnail preview is a normal quoted image/caption sent to ctx.chat, including LIDs', async () => {
  const { sock, m, run } = setup();
  await run(['thumbnail']);
  assert.equal(sock.lastSent.jid, '70000000001@lid');
  assert.ok(Buffer.isBuffer(sock.lastSent.content.image));
  assert.equal(sock.lastSent.options.quoted, m);
  assert.equal(sock.lastSent.options.mediaUploadTimeoutMs, 30_000);
  assert.match(sock.lastSent.content.caption, /Thumbnail menu preview/);
  assert.match(sock.lastSent.content.caption, /\.menu thumbnail media/);
  assert.ok(sock.lastSent.content.caption.includes(`v${version}`));
  assert.equal(sock.lastSent.content.contextInfo?.externalAdReply, undefined);
  assert.equal(sock.relayed.length, 0);
});

test('thumbnail is lazy, cached and resolved relative to menu.js rather than cwd', async (t) => {
  const original = fs.readFile;
  const read = t.mock.method(fs, 'readFile', (...args) => original(...args));
  const { run } = setup();
  await run(['thumbnail']);
  await run(['thumbnail']);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(
    read.mock.calls[0].arguments[0],
    path.resolve(__dirname, '../../Utils/assets/buggy.jpg'),
  );
});

test('list preview is a non-carousel native selector and does not read/upload an image', async (t) => {
  t.mock.method(fs, 'readFile', async () => assert.fail('list should not load an image'));
  const { sock, m, run } = setup();
  await run(['list']);
  const content = interactive(sock);
  assert.equal(content.carouselMessage, null);
  assert.equal(content.header.hasMediaAttachment, false);
  assert.ok(content.footer.text.includes(`v${version}`));
  assert.equal(content.contextInfo.stanzaId, m.key.id);
  assert.match(content.body.text, /\.menu list tools/);
  const rows = rowsFor(content);
  assert.ok(rows.length <= 9);
  assert.ok(rows.some((row) => readMenuSelection(row.id) === '.menu list media 1'));
  assert.ok(rows.some((row) => readMenuSelection(row.id) === '.menu list all 1'));
  assert.ok(!rows.some((row) => /:(admin|group):/.test(row.id)));
  assert.equal(sock.relayed[0].jid, m.key.remoteJid);
  assert.ok(sock.relayed[0].options.messageId);
  assert.equal(sock.uploads.length, 0);
});

test('carousel preview contains exactly ONE real protobuf card with image and working category IDs', async () => {
  const { sock, run } = setup();
  await run(['carousel']);
  const content = interactive(sock);
  assert.equal(content.carouselMessage.cards.length, 1);
  const card = content.carouselMessage.cards[0];
  assert.equal(card.header.hasMediaAttachment, true);
  assert.ok(card.header.imageMessage);
  assert.match(card.body.text, /Single-card carousel preview/);
  assert.match(card.body.text, /\.menu carousel tools/);
  const rows = rowsFor(card);
  assert.ok(rows.every((row) => readMenuSelection(row.id)?.startsWith('.menu carousel ')));
  assert.equal(sock.uploads.length, 1);
  assert.equal(sock.uploads[0][1].timeoutMs, 30_000);
});

test('both image menus pass the configured upload timeout, independent of Axios', async () => {
  const { sock, run } = setup({
    config: { network: { mediaUploadTimeoutMs: 45_000, fetchTimeoutMs: 1000 } },
  });
  await run(['thumbnail']);
  assert.equal(sock.lastSent.options.mediaUploadTimeoutMs, 45_000);
  await run(['carousel']);
  assert.equal(sock.uploads[0][1].timeoutMs, 45_000);
});

test('carousel upload timeout is logged and falls back without relaying a broken card', async (t) => {
  const { sock, run } = setup();
  const warn = t.mock.method(sock.logger, 'warn');
  sock.waUploadToServer = async () => {
    throw new Error('Upload timeout');
  };
  await run(['carousel']);
  assert.equal(sock.relayed.length, 0);
  assert.match(sock.lastSent.content.text, /could not be sent/i);
  assert.match(sock.lastSent.content.text, /\.menu carousel tools/);
  assert.equal(warn.mock.callCount(), 1);
});

test('missing image gives a useful text fallback, not a silent menu failure', async (t) => {
  t.mock.method(fs, 'readFile', async () => {
    throw Object.assign(new Error('missing fixture image'), { code: 'ENOENT' });
  });
  const { sock, run } = setup();
  const warn = t.mock.method(sock.logger, 'warn');
  await run(['thumbnail']);
  assert.match(sock.lastSent.content.text, /image unavailable/i);
  assert.match(sock.lastSent.content.text, /\.menu thumbnail tools/);
  assert.equal(warn.mock.callCount(), 1);
});

test('carousel can build a text-only card when the local image is missing', async (t) => {
  t.mock.method(fs, 'readFile', async () => {
    throw new Error('no image');
  });
  const { sock, run } = setup();
  await run(['carousel']);
  assert.equal(interactive(sock).carouselMessage.cards[0].header.hasMediaAttachment, false);
  assert.equal(sock.uploads.length, 0);
});

for (const style of ['carousel', 'list']) {
  test(`${style} relay failure is logged and falls back to typed text navigation`, async (t) => {
    const { sock, run } = setup();
    const warn = t.mock.method(sock.logger, 'warn');
    sock.relayMessage = async () => {
      throw new Error('internal delivery detail');
    };
    await run([style]);
    assert.match(sock.lastSent.content.text, /could not be sent/i);
    assert.ok(sock.lastSent.content.text.includes(`.menu ${style} tools`));
    assert.doesNotMatch(sock.lastSent.content.text, /internal delivery detail/);
    assert.equal(warn.mock.callCount(), 1);
  });
}

test('thumbnail delivery failure falls back without retrying an image upload', async () => {
  const { sock, run } = setup();
  const send = sock.sendMessage;
  let imageAttempts = 0;
  sock.sendMessage = async (...args) => {
    if (args[1].image) {
      imageAttempts++;
      throw new Error('image upload failed');
    }
    return send(...args);
  };
  await run(['thumbnail']);
  assert.equal(imageAttempts, 1);
  assert.match(sock.lastSent.content.text, /could not be sent/i);
});

test('admin/group categories are hidden in DMs; hidden/disabled/missing-config commands never appear', async () => {
  const { sock, run } = setup();
  await run(['all']);
  const text = sock.lastSent.content.text;
  assert.doesNotMatch(text, /serverinfo|oldadmin|secret|exec|disabled|virustotal|ytdl|\.warn/);
  assert.match(text, /\.sticker/);
  assert.match(text, /\.ping/);
  await run(['admin']);
  assert.match(sock.lastSent.content.text, /^No commands in this category are available here\./);
});

test('authorized group preview includes group/admin sections and uses the actual admin prefix', async () => {
  const { sock, run } = setup({ jid: '1000000000@g.us' });
  await run(['list'], { isAdmin: true });
  const rows = rowsFor(interactive(sock));
  assert.ok(rows.some((row) => /:group:/.test(row.id)));
  assert.ok(rows.some((row) => /:admin:/.test(row.id)));
  await run(['admin'], { isAdmin: true });
  assert.match(sock.lastSent.content.text, /\$serverinfo/);
  assert.match(sock.lastSent.content.text, /\$oldadmin/);
  assert.doesNotMatch(sock.lastSent.content.text, /\.exec/);
});

test('globally disabled AI hides generation commands but retains AI status discovery', async () => {
  const { sock, run } = setup({ config: { ai: { enabled: false } } });
  await run(['ai']);
  assert.match(sock.lastSent.content.text, /\.ai/);
  assert.doesNotMatch(sock.lastSent.content.text, /\.ask/);
  assert.match(sock.lastSent.content.text, /consent.*configuration.*budget/);
});

test('configured feature/required-key commands appear when enabled', async () => {
  const { sock, run } = setup({
    config: {
      features: { ytdl: true },
      apis: { virustotal: { apiKey: 'unit-test-placeholder' } },
    },
  });
  await run(['media']);
  assert.match(sock.lastSent.content.text, /\.ytdl/);
  await run(['feeds']);
  assert.match(sock.lastSent.content.text, /\.virustotal/);
  assert.doesNotMatch(sock.lastSent.content.text, /unit-test-placeholder/);
});

test('category and all-command output is paginated, sorted and bounded', async () => {
  const { sock, run } = setup();
  const items = Array.from({ length: 21 }, (_, index) => ({
    name: `tool${String(index).padStart(2, '0')}`,
    category: 'tools',
    desc: 'x'.repeat(1000),
  }));
  const commands = registry(items.reverse());
  await run(['list', 'tools', '1'], { commands });
  let text = sock.lastSent.content.text;
  assert.match(text, /Page 1\/3/);
  assert.equal((text.match(/^\.tool\d+/gm) || []).length, 8);
  assert.match(text, /Next: \.menu list tools 2/);
  assert.ok(text.length < 2500);
  await run(['all', '3'], { commands });
  text = sock.lastSent.content.text;
  assert.match(text, /Page 3\/3/);
  assert.equal((text.match(/^\.tool\d+/gm) || []).length, 5);
  assert.match(text, /Previous:/);
  assert.doesNotMatch(text, /Next:/);
  await run(['tools', '99'], { commands });
  assert.match(sock.lastSent.content.text, /page does not exist/i);
});

for (const args of [
  ['unknown'],
  ['list', 'tools', '0'],
  ['list', 'all', 'nope'],
  ['carousel', 'home', '2'],
  ['list', 'all', '1', 'extra'],
]) {
  test(`invalid navigation ${args.join(' ')} returns usage without sending rich content`, async () => {
    const { sock, run } = setup();
    await run(args);
    assert.match(sock.lastSent.content.text, /Unknown menu category or page/);
    assert.equal(sock.uploads.length, 0);
    assert.equal(sock.relayed.length, 0);
  });
}

test('empty registries still produce a useful list and an empty-category reply', async () => {
  const { sock, run } = setup();
  await run(['list'], { commands: registry([]) });
  assert.equal(rowsFor(interactive(sock)).length, 1);
  await run(['all'], { commands: registry([]) });
  assert.match(sock.lastSent.content.text, /No commands/);
});

test('custom and regex-matched prefixes are preserved in typed navigation and selection IDs', async () => {
  for (const [configured, matched, expected] of [
    ['!', '!', '!'],
    [/^[.!]/, '!', '!'],
  ]) {
    const { sock, run } = setup({
      config: {
        bot: { name: 'CustomFox', prefix: configured, adminPrefix: '%' },
      },
    });
    await run(['list'], { prefix: matched });
    const content = interactive(sock);
    assert.match(content.header.title, /CustomFox/);
    assert.ok(
      rowsFor(content).every((row) => readMenuSelection(row.id)?.startsWith(`${expected}menu `)),
    );
  }
});

test('all supported selection routes round-trip and can only invoke menu', () => {
  for (const prefix of ['.', '!', '$', ':', '🦊']) {
    for (const style of MENU_STYLES) {
      for (const target of ['all', ...MENU_CATEGORIES]) {
        const id = makeMenuSelection(prefix, style, target, 2);
        assert.equal(readMenuSelection(id), `${prefix}menu ${style} ${target} 2`);
      }
      assert.equal(readMenuSelection(makeMenuSelection(prefix, style)), `${prefix}menu ${style}`);
    }
  }
});

test('native responses use the ID, never the visible label', () => {
  const id = makeMenuSelection('!', 'list', 'tools');
  for (const name of ['single_select', 'quick_reply']) {
    assert.equal(
      readNativeMenuResponse({
        name,
        paramsJson: JSON.stringify({ id, display_text: '$exec malicious' }),
      }),
      '!menu list tools 1',
    );
  }
});

test('malformed, oversized and arbitrary native-flow IDs cannot execute other commands', () => {
  for (const paramsJson of [
    '{',
    'null',
    '[]',
    '42',
    '"text"',
    JSON.stringify({ id: '$exec malicious' }),
    JSON.stringify({ id: {} }),
    JSON.stringify({ id: '.ping' }),
    ' '.repeat(4097),
  ]) {
    assert.equal(readNativeMenuResponse({ name: 'single_select', paramsJson }), '');
  }
  assert.equal(
    readNativeMenuResponse({
      name: 'unknown',
      paramsJson: JSON.stringify({ id: makeMenuSelection('.', 'list') }),
    }),
    '',
  );
  assert.equal(readNativeMenuResponse({ name: 'single_select', paramsJson: {} }), '');
});

test('invalid menu IDs fail closed, including injected routes, malformed encoding and bad pages', () => {
  for (const id of [
    null,
    {},
    'x'.repeat(513),
    '.menu list',
    'echofox-menu:v2:.:list:tools:1',
    'echofox-menu:v1:%ZZ:list:tools:1',
    'echofox-menu:v1:.:list:tools $exec:1',
    'echofox-menu:v1:.:list:tools:0',
    'echofox-menu:v1:.:list:tools:99999',
    'echofox-menu:v1:.:list:home:2',
    'echofox-menu:v1:%0A%24:carousel:all:1',
    'echofox-menu:v1:.:other:tools:1',
  ]) {
    assert.equal(readMenuSelection(id), null);
  }
  assert.throws(() => makeMenuSelection('.', 'list', 'not-a-category'), TypeError);
  assert.throws(() => makeMenuSelection('\n$', 'list'), TypeError);
});
