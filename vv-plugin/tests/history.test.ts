import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import { createStore } from '../store.ts';
import plugin from '../server.ts';

test('history pages cover all tied timestamps, locate old roots, retain full thread counts and enforce conversation access', async (t) => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'slack' });
  try {
    t.mock.method(Date, 'now', () => 1793215000000);
    const store = createStore(bb),
      human = store.actor().id;
    const other = store.actor('unrelated').id;
    const room = store.createRoom({ name: 'history', description: '' }, human);
    const send = (
      text: string,
      parentId: string | null = null,
      roomId = room.id,
    ) =>
      store.send(
        {
          id: randomUUID(),
          roomId,
          text,
          parentId,
          rich: null,
          attachment: null,
        },
        human,
      );
    const roots = Array.from({ length: 451 }, (_, i) => send(`Root ${i}`));
    const replies = Array.from({ length: 207 }, (_, i) =>
      send(`Reply ${i}`, roots[0].id),
    );
    const latest = store.history({ roomId: room.id }, human);
    assert.deepEqual(
      latest.messages.map((m) => m.id),
      roots.slice(-100).map((m) => m.id),
    );
    assert.equal(latest.after, null);
    const collected = [...latest.messages];
    let page = latest;
    while (page.before) {
      page = store.history({ roomId: room.id, before: page.before }, human);
      collected.unshift(...page.messages);
    }
    assert.deepEqual(
      collected.map((m) => m.id),
      roots.map((m) => m.id),
    );
    assert.equal(new Set(collected.map((m) => m.id)).size, 451);
    const newer = store.history({ roomId: room.id, after: page.after! }, human);
    assert.deepEqual(
      newer.messages.map((m) => m.id),
      roots.slice(51, 151).map((m) => m.id),
    );
    const around = store.history(
      { roomId: room.id, around: roots[180].id },
      human,
    );
    assert.equal(around.messages[50].id, roots[180].id);
    assert(around.before && around.after);
    const oldest = store.history(
      { roomId: room.id, around: roots[0].id },
      human,
    );
    assert.equal(oldest.messages[0].replyCount, 207);
    assert.equal(oldest.messages[0].lastReply?.author, human);
    let thread = store.history(
      { roomId: room.id, parentId: roots[0].id },
      human,
    );
    assert.equal(thread.parent?.id, roots[0].id);
    assert.equal(thread.parent.replyCount, 207);
    const allReplies = [...thread.messages];
    while (thread.before) {
      thread = store.history(
        { roomId: room.id, parentId: roots[0].id, before: thread.before },
        human,
      );
      allReplies.unshift(...thread.messages);
    }
    assert.deepEqual(
      allReplies.map((m) => m.id),
      replies.map((m) => m.id),
    );
    assert.throws(
      () =>
        store.history(
          { roomId: room.id, before: roots[0].id, after: roots[1].id },
          human,
        ),
      /one history cursor/,
    );
    assert.throws(
      () => store.history({ roomId: room.id, before: replies[0].id }, human),
      /cursor not available/,
    );
    assert.throws(
      () => store.history({ roomId: room.id, parentId: replies[0].id }, human),
      /top-level/,
    );
    const dm = store.createRoom(
      { name: 'Private', description: '', recipient: other },
      human,
    );
    const secret = send('Private', null, dm.id);
    assert.throws(
      () => store.history({ roomId: room.id, around: secret.id }, human),
      /cursor not available/,
    );
    assert.throws(
      () => store.history({ roomId: dm.id }, store.actor('outsider').id),
      /not available/,
    );
    assert.throws(
      () => store.history({ roomId: room.id, parentId: secret.id }, human),
      /top-level/,
    );
    assert.equal(
      createStore(bb).history({ roomId: room.id, around: roots[0].id }, human)
        .messages[0].replyCount,
      207,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test('history is available through RPC, the agent tool and CLI with the actual caller identity', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'slack' });
  try {
    plugin(bb);
    const message = {
      id: randomUUID(),
      roomId: 'general',
      text: 'History fixture',
    };
    await harness.behavior.callRpc('send', message);
    const page = (await harness.behavior.callRpc('history', {
      roomId: 'general',
      around: message.id,
    })) as { messages: { id: string }[] };
    assert.equal(page.messages[0].id, message.id);
    const native = await harness.behavior.callAgentTool(
      'vv_slack',
      { action: 'history', roomId: 'general', around: message.id },
      { threadId: 'history-agent' },
    );
    assert.match(JSON.stringify(native), new RegExp(message.id));
    const result = await harness.behavior.runCli([
      'call',
      '--input',
      JSON.stringify({ action: 'history', roomId: 'general' }),
      '--json',
    ]);
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.stdout!).messages[0].id, message.id);
    await assert.rejects(
      harness.behavior.callRpc('history', {
        roomId: 'general',
        before: message.id,
        after: message.id,
      }),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test('inaccessible DM traffic does not crowd visible search matches out of the result limit', async (t) => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'slack' });
  try {
    t.mock.method(Date, 'now', () => 1793215000000);
    const store = createStore(bb),
      human = store.actor().id;
    const peer = store.actor('dm-peer').id,
      outsider = store.actor('search-agent').id;
    const base = {
      roomId: 'general',
      text: 'needle visible',
      parentId: null,
      rich: null,
      attachment: null,
    };
    const visible = store.send({ ...base, id: randomUUID() }, human);
    const dm = store.createRoom(
      { name: 'Private', description: '', recipient: peer },
      human,
    );
    for (let i = 0; i < 301; i++)
      store.send(
        { ...base, id: randomUUID(), roomId: dm.id, text: 'needle private' },
        human,
      );
    assert.deepEqual(
      store.search('needle', false, outsider).map((m) => m.id),
      [visible.id],
    );
    assert.equal(store.search('needle', false, human).length, 100);
    store.save(visible.id, outsider);
    assert.deepEqual(
      store.search('', true, outsider).map((m) => m.id),
      [visible.id],
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
