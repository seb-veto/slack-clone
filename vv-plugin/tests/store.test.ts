import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';
import { createStore } from '../store.ts';

test('persistent store: identity, DM isolation, exact retries, reply integrity, edits, attachments and drafts', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'slack' });
  try {
    const store = createStore(bb);
    const human = store.actor().id,
      agent = store.actor('thread-one').id,
      other = store.actor('thread-two').id;
    const room = store.createRoom(
      { name: 'qa', description: 'Synthetic verification' },
      human,
    );
    const input = {
      id: randomUUID(),
      roomId: room.id,
      text: 'hello',
      rich: null,
      parentId: null,
      attachment: null,
    };
    const sent = store.send(input, agent);
    assert.equal(sent.author, agent);
    assert.equal(store.send(input, agent).id, sent.id);
    assert.throws(
      () => store.send({ ...input, text: 'different' }, agent),
      /different message/,
    );
    assert.throws(() => store.send(input, human), /different message/);
    assert.throws(
      () => store.edit({ id: sent.id, text: 'spoofed', rich: null }, human),
      /Only the author/,
    );
    assert.equal(
      store.edit({ id: sent.id, text: 'updated', rich: null }, agent).text,
      'updated',
    );
    const reply = store.send(
      { ...input, id: randomUUID(), text: 'reply', parentId: sent.id },
      human,
    );
    assert.equal(reply.parentId, sent.id);
    assert.throws(
      () =>
        store.send({ ...input, id: randomUUID(), parentId: reply.id }, human),
      /top-level/,
    );
    assert.throws(
      () =>
        store.send(
          { ...input, id: randomUUID(), roomId: 'general', parentId: sent.id },
          human,
        ),
      /this conversation/,
    );
    assert.equal(
      store.react(sent.id, '👍', human).reactions[0].members[0],
      human,
    );
    assert.equal(store.react(sent.id, '👍', human).reactions.length, 0);
    store.save(sent.id, human);
    assert.equal(store.search('', true, human)[0].id, sent.id);
    const dm = store.createRoom(
      { name: 'Agent', description: '', recipient: agent },
      human,
    );
    assert.equal(
      store.createRoom(
        { name: 'Agent', description: '', recipient: human },
        agent,
      ).id,
      dm.id,
    );
    assert(!store.listRooms(other).some((r) => r.id === dm.id));
    assert.throws(() => store.snapshot(dm.id, other), /not available/);
    const secret = store.send(
      { ...input, id: randomUUID(), roomId: dm.id, text: 'private-test' },
      human,
    );
    assert.throws(() => store.readMessage(secret.id, other), /not available/);
    assert.equal(store.search('private-test', false, other).length, 0);
    assert.throws(() => store.attachment(secret.id, other), /not available/);
    const rich = { ops: [{ insert: 'draft\n', attributes: { bold: true } }] };
    store.draft(`${room.id}|main`, rich, human);
    assert.deepEqual(store.draft(`${room.id}|main`, undefined, human), rich);
    assert.equal(store.draft(`${room.id}|main`, undefined, agent), null);
    assert.throws(
      () => store.send({ ...input, id: randomUUID(), rich }, human),
      /does not match/,
    );
    assert.throws(
      () =>
        store.draft(
          'oversized',
          {
            ops: [{ insert: ' '.repeat(20000) }, { insert: ' '.repeat(20000) }],
          },
          human,
        ),
      /30,000/,
    );
    const file = {
      name: 'synthetic.txt',
      mime: 'text/plain' as const,
      data: Buffer.from('example').toString('base64'),
    };
    const attached = store.send(
      { ...input, id: randomUUID(), attachment: file },
      human,
    );
    assert.deepEqual(store.attachment(attached.id, human), file);
    assert.equal(
      store.send({ ...input, id: randomUUID(), roomId: room.id }, other).author,
      other,
    );
    assert(store.listRooms(human).find((r) => r.id === room.id)!.unread > 0);
    store.markRead(room.id, Date.now(), human);
    assert.equal(
      store.listRooms(human).find((r) => r.id === room.id)!.unread,
      0,
    );
    const reloaded = createStore(bb);
    assert.equal(reloaded.snapshot(room.id, human).messages.length, 4);
    assert.deepEqual(reloaded.draft(`${room.id}|main`, undefined, human), rich);
    store.remove(attached.id, human);
    assert.throws(() => store.attachment(attached.id, human), /unavailable/);
    assert(store.readMessage(reply.id, human).text === 'reply');
  } finally {
    await harness.lifecycle.dispose();
  }
});

test('actual plugin RPC, native tool and CLI share storage and validate inputs', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'slack' });
  try {
    plugin(bb);
    const initial = (await harness.behavior.callRpc('snapshot', {
      roomId: 'general',
    })) as { me: { id: string } };
    assert.equal(initial.me.id, 'human');
    const native = await harness.behavior.callAgentTool(
      'vv_slack',
      { action: 'channels' },
      { threadId: 'native-test' },
    );
    assert.match(JSON.stringify(native), /agent:native-test/);
    const toolMessage = {
      action: 'send',
      id: randomUUID(),
      roomId: 'general',
      text: 'native tool message',
    };
    const posted = await harness.behavior.callAgentTool(
      'vv_slack',
      toolMessage,
      { threadId: 'native-test' },
    );
    assert.match(JSON.stringify(posted), /agent:native-test/);
    const secondTool = await harness.behavior.callAgentTool(
      'vv_slack',
      { ...toolMessage, id: randomUUID(), text: 'second native message' },
      { threadId: 'other-native' },
    );
    assert.match(JSON.stringify(secondTool), /agent:other-native/);
    const input = {
      id: randomUUID(),
      roomId: 'general',
      text: 'synthetic RPC message',
    };
    const first = (await harness.behavior.callRpc('send', input)) as {
      id: string;
    };
    assert.equal(first.id, input.id);
    assert.equal(
      ((await harness.behavior.callRpc('send', input)) as { id: string }).id,
      input.id,
    );
    await assert.rejects(
      harness.behavior.callRpc('send', { ...input, text: '' }),
    );
    const result = await harness.behavior.runCli([
      'call',
      '--input',
      '{"action":"read","roomId":"general"}',
      '--json',
    ]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout!, /synthetic RPC message/);
    const invalid = await harness.behavior.runCli([
      'call',
      '--input',
      '{"action":"bogus"}',
    ]);
    assert.equal(invalid.exitCode, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});
