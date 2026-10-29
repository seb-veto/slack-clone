import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import { createStore } from '../store.ts';
import plugin from '../server.ts';
import type { Todo } from '../todo-contract.ts';

test('personal to-dos preserve exact creation retries, message permissions, saved transitions, reminder state and tombstones', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'slack' });
  try {
    const s = createStore(bb),
      human = s.actor().id,
      agent = s.actor('todo-agent').id,
      other = s.actor('other').id;
    const room = s.createRoom({ name: 'todo-qa', description: '' }, human);
    const m = s.send(
      {
        id: randomUUID(),
        roomId: room.id,
        text: 'Follow up',
        rich: null,
        parentId: null,
        attachment: null,
      },
      human,
    );
    s.save(m.id, human);
    const input = { id: randomUUID(), messageId: m.id };
    const added = s.todos.create(input, human);
    assert.equal(added.message?.id, m.id);
    assert.equal(s.readMessage(m.id, human).todoId, added.id);
    assert.equal(s.readMessage(m.id, human).saved, false);
    assert.equal(s.todos.create(input, human).id, added.id);
    assert.throws(() => s.todos.create({ ...input, text: 'different' }, human));
    assert.throws(
      () => s.todos.create({ ...input, id: randomUUID() }, human),
      /already has/,
    );
    assert.throws(() => s.todos.create(input, agent), /different/);
    assert.equal(s.todos.list({}, agent).total, 0);
    assert.throws(
      () => s.todos.update({ id: added.id, completed: true }, agent),
      /not available/,
    );
    s.todos.update({ id: added.id, dueAt: Date.now() - 1000 }, human);
    assert.equal(s.todos.dueCount(human), 1);
    s.todos.update({ id: added.id, completed: true }, human);
    assert.equal(s.todos.dueCount(human), 0);
    assert.notEqual(s.todos.create(input, human).completedAt, null);
    s.todos.update({ id: added.id, destination: 'saved' }, human);
    assert.equal(s.readMessage(m.id, human).saved, true);
    assert.equal(s.readMessage(m.id, human).todoId, null);
    assert.equal(s.todos.create(input, human).destination, 'cleared');
    const custom = s.todos.create(
      { id: randomUUID(), text: 'Personal details' },
      human,
    );
    s.todos.update(
      { id: custom.id, completed: true, destination: 'saved' },
      human,
    );
    assert.equal(
      s.todos.list({ destination: 'saved' }, human).items[0].text,
      'Personal details',
    );
    assert.equal(
      s.todos.update({ id: custom.id, destination: 'todos' }, human)
        .completedAt,
      null,
    );
    assert.equal(
      s.todos.update({ id: custom.id, dueAt: null, text: 'Updated' }, human)
        .text,
      'Updated',
    );
    const again = s.todos.create({ id: randomUUID(), messageId: m.id }, human);
    s.remove(m.id, human);
    const tomb = s.todos.list({}, human).items.find((t) => t.id === again.id)!;
    assert.equal(tomb.message?.deleted, true);
    assert.equal(tomb.message?.text, '');
    assert.throws(
      () => s.todos.create({ id: randomUUID(), messageId: m.id }, other),
      /deleted/,
    );
    const dm = s.createRoom(
      { name: 'private', description: '', recipient: agent },
      human,
    );
    const secret = s.send(
      {
        id: randomUUID(),
        roomId: dm.id,
        text: 'Private content',
        rich: null,
        parentId: null,
        attachment: null,
      },
      human,
    );
    assert.throws(
      () => s.todos.create({ id: randomUUID(), messageId: secret.id }, other),
      /available/,
    );
    const privateTodo = s.todos.create(
      { id: randomUUID(), messageId: secret.id, dueAt: 1 },
      agent,
    );
    bb.storage
      .database()
      .prepare('UPDATE rooms SET recipient=? WHERE id=?')
      .run(other, dm.id);
    assert.equal(s.todos.list({}, agent).total, 0);
    assert.equal(s.todos.dueCount(agent), 0);
    assert.throws(
      () => s.todos.update({ id: privateTodo.id, completed: true }, agent),
      /not available/,
    );
    const reloaded = createStore(bb);
    assert(
      reloaded.todos.list({}, human).items.some((t) => t.text === 'Updated'),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test('to-do paging, status/reminder filters and sorting include all personal rows with stable ties', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'slack' });
  try {
    const s = createStore(bb),
      who = s.actor().id;
    const ids: string[] = [];
    for (let i = 0; i < 125; i++) {
      const id = randomUUID();
      ids.push(id);
      s.todos.create(
        {
          id,
          text: `item ${i}`,
          dueAt: i < 40 ? 1 : i < 80 ? Date.now() + 86400000 : null,
        },
        who,
      );
    }
    bb.storage.database().prepare('UPDATE todos SET createdAt=100').run();
    const a = s.todos.list({ sort: 'oldest' }, who),
      b = s.todos.list({ sort: 'oldest', offset: a.nextOffset! }, who);
    assert.equal(a.items.length, 100);
    assert.equal(b.items.length, 25);
    assert.equal(b.nextOffset, null);
    assert.deepEqual(
      [...a.items, ...b.items].map((t) => t.id),
      ids.sort(),
    );
    assert.equal(s.todos.list({ reminder: 'overdue' }, who).total, 40);
    assert.equal(s.todos.list({ reminder: 'upcoming' }, who).total, 40);
    assert.equal(s.todos.list({ reminder: 'none' }, who).total, 45);
    s.todos.update({ id: ids[0], completed: true }, who);
    assert.equal(s.todos.list({ status: 'completed' }, who).total, 1);
    assert.equal(s.todos.list({ status: 'in_progress' }, who).total, 124);
    assert.throws(() => s.todos.list({ offset: -1 }, who));
    assert.throws(() =>
      s.todos.create({ id: randomUUID(), text: '<script>', dueAt: NaN }, who),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test('RPC, actual native tool and CLI bind private to-dos to the real caller', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'slack' });
  try {
    plugin(bb);
    const human = (await harness.behavior.callRpc('todoCreate', {
      id: randomUUID(),
      text: 'Human task',
    })) as Todo;
    assert.equal(human.text, 'Human task');
    const agentTodoId = randomUUID();
    const posted = await harness.behavior.callAgentTool(
      'vv_slack',
      { action: 'todo_create', id: agentTodoId, text: 'Agent task' },
      { threadId: 'todo-native' },
    );
    assert.match(JSON.stringify(posted), /Agent task/);
    const changed = await harness.behavior.callAgentTool(
      'vv_slack',
      { action: 'todo_update', id: agentTodoId, completed: true },
      { threadId: 'todo-native' },
    );
    assert.notEqual(JSON.parse(changed as string).completedAt, null);
    const other = await harness.behavior.callAgentTool(
      'vv_slack',
      { action: 'todos' },
      { threadId: 'other-native' },
    );
    assert.doesNotMatch(JSON.stringify(other), /Agent task|Human task/);
    const own = await harness.behavior.callAgentTool(
      'vv_slack',
      { action: 'todos' },
      { threadId: 'todo-native' },
    );
    assert.match(JSON.stringify(own), /Agent task/);
    assert.doesNotMatch(JSON.stringify(own), /Human task/);
    const cli = await harness.behavior.runCli([
      'call',
      '--input',
      '{"action":"todos"}',
      '--json',
    ]);
    assert.equal(cli.exitCode, 0);
    assert.match(cli.stdout!, /Human task/);
    assert.doesNotMatch(cli.stdout!, /Agent task/);
    await assert.rejects(
      harness.behavior.callRpc('todoCreate', {
        id: randomUUID(),
        text: '',
        messageId: null,
      }),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
