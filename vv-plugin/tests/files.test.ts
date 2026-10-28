import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import { createStore } from '../store.ts';
import plugin from '../server.ts';

test('file browser pages tied timestamps, filters literal filenames/types, scopes conversations and excludes private/deleted files', async (t) => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'slack' });
  try {
    t.mock.method(Date, 'now', () => 1793215000000);
    const store = createStore(bb),
      human = store.actor().id,
      peer = store.actor('file-peer').id,
      outsider = store.actor('file-outsider').id;
    const room = store.createRoom({ name: 'files', description: '' }, human);
    const send = (
      name: string,
      mime: 'image/png' | 'application/pdf' | 'text/plain' = 'image/png',
      roomId = room.id,
      parentId: string | null = null,
    ) =>
      store.send(
        {
          id: randomUUID(),
          roomId,
          text: 'Synthetic file message',
          parentId,
          rich: null,
          attachment: {
            name,
            mime,
            data: Buffer.from('Synthetic').toString('base64'),
          },
        },
        human,
      );
    const images = Array.from({ length: 151 }, (_, i) =>
      send(`image-${i}.png`),
    );
    const pdf = send("100%_o'hare.pdf", 'application/pdf');
    const text = send('<literal>.txt', 'text/plain', room.id, images[0].id);
    const dm = store.createRoom(
      { name: 'Private', description: '', recipient: peer },
      human,
    );
    for (let i = 0; i < 101; i++) send(`private-${i}.png`, 'image/png', dm.id);
    const latest = store.files({}, outsider);
    assert.equal(latest.messages.length, 100);
    const all = [...latest.messages];
    let page = latest;
    while (page.next) {
      page = store.files({ before: page.next }, outsider);
      all.push(...page.messages);
    }
    assert.deepEqual(
      all.map((m) => m.id),
      [...images, pdf, text].reverse().map((m) => m.id),
    );
    assert.equal(new Set(all.map((m) => m.id)).size, 153);
    assert.deepEqual(
      store
        .files({ query: "%_o'hare", type: 'pdfs' }, outsider)
        .messages.map((m) => m.id),
      [pdf.id],
    );
    assert.deepEqual(
      store.files({ type: 'text' }, outsider).messages.map((m) => m.id),
      [text.id],
    );
    assert.equal(
      store.files({ roomId: room.id, type: 'images' }, human).messages.length,
      100,
    );
    assert.equal(
      store.files({ query: 'private' }, outsider).messages.length,
      0,
    );
    assert.equal(store.files({ roomId: dm.id }, peer).messages.length, 100);
    assert.throws(
      () => store.files({ roomId: dm.id }, outsider),
      /not available/,
    );
    const secret = store.files({ roomId: dm.id }, human).messages[0];
    assert.throws(
      () => store.files({ before: secret.id }, outsider),
      /not available/,
    );
    assert.throws(
      () => store.files({ roomId: room.id, before: secret.id }, human),
      /cursor not available/,
    );
    const before = latest.next!;
    store.remove(before, human);
    assert.equal(store.files({ before }, outsider).messages.length, 53);
    store.remove(pdf.id, human);
    assert.equal(store.files({ type: 'pdfs' }, outsider).messages.length, 0);
    assert.throws(() => store.attachment(pdf.id, outsider), /unavailable/);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test('files RPC and native tool expose only metadata visible to the caller', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'slack' });
  try {
    plugin(bb);
    const id = randomUUID();
    await harness.behavior.callRpc('send', {
      id,
      roomId: 'general',
      text: 'File metadata fixture',
      attachment: {
        name: 'shared.txt',
        mime: 'text/plain',
        data: Buffer.from('PRIVATE FILE BYTES').toString('base64'),
      },
    });
    const result = (await harness.behavior.callRpc('files', {
      type: 'text',
    })) as { messages: { id: string; attachment: unknown }[] };
    assert.equal(result.messages[0].id, id);
    assert.deepEqual(result.messages[0].attachment, {
      name: 'shared.txt',
      mime: 'text/plain',
    });
    const native = await harness.behavior.callAgentTool(
      'vv_slack',
      { action: 'files' },
      { threadId: 'file-native' },
    );
    assert.match(JSON.stringify(native), /shared.txt/);
    assert(!JSON.stringify(native).includes('UFJJVkFURSBGSUxFIEJZVEVT'));
    const cli = await harness.behavior.runCli([
      'call',
      '--input',
      '{"action":"files","type":"text"}',
      '--json',
    ]);
    assert.equal(cli.exitCode, 0);
    assert.equal(JSON.parse(cli.stdout!).messages[0].id, id);
    await assert.rejects(
      harness.behavior.callRpc('files', { type: 'executable' }),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
