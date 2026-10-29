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
    const reviewRaw = await harness.behavior.callAgentTool(
      'vv_slack',
      { action: 'todo_bulk_prepare', operation: 'clear' },
      { threadId: 'todo-native' },
    );
    const review = JSON.parse(reviewRaw as string);
    assert.equal(review.count, 1);
    await assert.rejects(
      harness.behavior.callAgentTool(
        'vv_slack',
        { action: 'todo_bulk_apply', id: review.id },
        { threadId: 'other-native' },
      ),
    );
    const applied = await harness.behavior.callAgentTool(
      'vv_slack',
      { action: 'todo_bulk_apply', id: review.id },
      { threadId: 'todo-native' },
    );
    assert.deepEqual(JSON.parse(applied as string), { count: 1 });
    const humanReview = (await harness.behavior.callRpc('todoBulkPrepare', {
      action: 'complete',
    })) as { id: string; count: number };
    assert.equal(humanReview.count, 1);
    assert.deepEqual(
      await harness.behavior.callRpc('todoBulkApply', { id: humanReview.id }),
      { count: 1 },
    );

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

test('bulk review freezes every filtered page, rejects changed rows atomically and replays only its own receipt', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'slack' });
  try {
    const s = createStore(bb),
      who = s.actor().id,
      other = s.actor('other').id;
    const add = (text: string, dueAt: number | null = 1) =>
      s.todos.create({ id: randomUUID(), text, dueAt }, who);
    for (let n = 0; n < 125; n++) add(`Due ${n}`);
    const future = add('Future', Date.now() + 86400000);
    const completed = add('Already done');
    s.todos.update({ id: completed.id, completed: true }, who);
    s.todos.create({ id: randomUUID(), text: 'Other owner', dueAt: 1 }, other);
    const preview = s.todos.prepareBulk(
      { action: 'complete', status: 'in_progress', reminder: 'overdue' },
      who,
    );
    assert.equal(preview.count, 125);
    assert.equal(
      s.todos.list({ status: 'completed' }, who).total,
      1,
      'preview is read-only',
    );
    assert.throws(() => s.todos.applyBulk(preview.id, other), /not available/);
    const addedLater = add('Added after review');
    const receipt = s.todos.applyBulk(preview.id, who);
    assert.deepEqual(receipt, { count: 125 });
    assert.equal(s.todos.list({ status: 'in_progress' }, who).total, 2);
    assert.deepEqual(s.todos.applyBulk(preview.id, who), receipt);
    assert.equal(
      s.todos.list({ status: 'in_progress' }, who).total,
      2,
      'retry does not catch new items',
    );
    const stale = s.todos.prepareBulk({ action: 'clear' }, who);
    s.todos.update({ id: future.id, text: 'Edited after review' }, who);
    assert.throws(() => s.todos.applyBulk(stale.id, who), /changed/);
    assert.equal(
      s.todos.list({}, who).total,
      128,
      'stale review writes nothing',
    );
    const saved = s.todos.prepareBulk(
      { action: 'saved', status: 'in_progress' },
      who,
    );
    assert.equal(saved.count, 2);
    s.todos.applyBulk(saved.id, who);
    assert.equal(s.todos.list({ destination: 'saved' }, who).total, 2);
    assert.equal(s.todos.list({}, other).total, 1);
    const clear = s.todos.prepareBulk(
      { action: 'clear', status: 'completed' },
      who,
    );
    s.todos.applyBulk(clear.id, who);
    assert.equal(s.todos.list({}, who).total, 0);
    assert.equal(
      s.todos.create(
        { id: addedLater.id, text: 'Added after review', dueAt: 1 },
        who,
      ).destination,
      'saved',
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test('bulk Saved conversion rolls back all rows on a deleted original and rechecks DM access', async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: 'slack' });
  try {
    const s = createStore(bb),
      who = s.actor().id,
      agent = s.actor('bulk-agent').id,
      other = s.actor('other').id;
    const room = s.createRoom(
      { name: 'bulk-private', description: '', recipient: agent },
      who,
    );
    const m = s.send(
      {
        id: randomUUID(),
        roomId: room.id,
        text: 'Private',
        parentId: null,
        attachment: null,
        rich: null,
      },
      who,
    );
    const custom = s.todos.create(
      { id: '00000000-0000-4000-8000-000000000001', text: 'Keep unchanged' },
      who,
    );
    const linked = s.todos.create(
      { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', messageId: m.id },
      who,
    );
    const preview = s.todos.prepareBulk({ action: 'saved' }, who);
    s.remove(m.id, who);
    assert.throws(() => s.todos.applyBulk(preview.id, who), /deleted/);
    assert.equal(s.todos.list({}, who).total, 2);
    assert.equal(s.todos.list({ destination: 'saved' }, who).total, 0);
    assert.equal(
      s.todos.create({ id: custom.id, text: 'Keep unchanged' }, who)
        .destination,
      'todos',
    );
    const privateTodo = s.todos.create(
      { id: randomUUID(), text: 'Agent private' },
      agent,
    );
    // A deleted message cannot be used for a new to-do; create a fresh one for access revocation.
    const m2 = s.send(
      {
        id: randomUUID(),
        roomId: room.id,
        text: 'Access check',
        parentId: null,
        attachment: null,
        rich: null,
      },
      who,
    );
    s.todos.create({ id: randomUUID(), messageId: m2.id }, agent);
    const before = s.todos.prepareBulk({ action: 'clear' }, agent);
    bb.storage
      .database()
      .prepare('UPDATE rooms SET recipient=? WHERE id=?')
      .run(other, room.id);
    assert.throws(() => s.todos.applyBulk(before.id, agent), /not available/);
    assert.equal(
      s.todos.prepareBulk({ action: 'clear' }, agent).count,
      1,
      'inaccessible linked item excluded',
    );
    assert.equal(
      s.todos.create({ id: privateTodo.id, text: 'Agent private' }, agent)
        .destination,
      'todos',
    );
    assert.equal(
      s.todos.create({ id: linked.id, messageId: m.id }, who).destination,
      'todos',
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
