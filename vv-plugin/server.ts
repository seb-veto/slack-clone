import { z } from 'zod';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import {
  rpcContract,
  id,
  roomInput,
  sendInput,
  historyInput,
  filesInput,
  todoCreate,
  todoUpdate,
  todoList,
  todoBulkPrepare,
} from './contract.ts';
import { createStore } from './store.ts';
import { createIntelligence } from './intelligence.ts';
export { rpcContract } from './contract.ts';

export default function plugin(bb: BbPluginApi) {
  const store = createStore(bb);
  const intelligence = createIntelligence(bb, store);
  const changed = <T>(value: T): T => {
    bb.realtime.publish('changed', {});
    return value;
  };
  const human = store.actor().id;
  bb.rpc.register(rpcContract, {
    todoBulkPrepare: (v) => store.todos.prepareBulk(v, human),
    todoBulkApply: (v) => changed(store.todos.applyBulk(v.id, human)),
    todoCreate: (v) => changed(store.todos.create(v, human)),
    todoUpdate: (v) => changed(store.todos.update(v, human)),
    todoList: (v) => store.todos.list(v, human),
    todoDueCount: () => store.todos.dueCount(human),
    files: (v) => store.files(v, human),
    history: (v) => store.history(v, human),
    assistant: (v) => intelligence.read(v.roomId),
    startAssistant: (v) => intelligence.start(v),
    snapshot: (v) => store.snapshot(v.roomId, human),
    createRoom: (v) => changed(store.createRoom(v, human)),
    send: (v) => changed(store.send(v, human)),
    edit: (v) => changed(store.edit(v, human)),
    remove: (v) => changed(store.remove(v.id, human)),
    react: (v) => changed(store.react(v.id, v.emoji, human)),
    save: (v) => changed(store.save(v.id, human)),
    search: (v) =>
      store.search(v.query === '*' && v.saved ? '' : v.query, v.saved, human),
    markRead: (v) => store.markRead(v.roomId, v.through, human),
    draft: (v) => store.draft(v.key, v.value, human),
    settings: (v) => changed(store.settings(v.workspace, v.name)),
    attachment: (v) => store.attachment(v.id, human),
  });
  const operations = z.discriminatedUnion('action', [
    z.object({ action: z.literal('channels') }),
    todoCreate.safeExtend({ action: z.literal('todo_create') }),
    todoUpdate.safeExtend({ action: z.literal('todo_update') }),
    todoList.extend({ action: z.literal('todos') }),
    todoBulkPrepare
      .omit({ action: true })
      .extend({
        action: z.literal('todo_bulk_prepare'),
        operation: todoBulkPrepare.shape.action,
      }),
    z.object({ action: z.literal('todo_bulk_apply'), id: z.string().uuid() }),
    z.object({ action: z.literal('read'), roomId: id }),
    z.object({ action: z.literal('history'), ...historyInput.shape }),
    z.object({ action: z.literal('files'), ...filesInput.shape }),
    z.object({ action: z.literal('create'), ...roomInput.shape }),
    z.object({ action: z.literal('send'), ...sendInput.shape }),
    z.object({
      action: z.literal('search'),
      query: z.string().trim().min(1).max(200),
    }),
    z.object({
      action: z.literal('react'),
      id,
      emoji: z.string().min(1).max(20),
    }),
  ]);
  function execute(
    input: z.infer<typeof operations>,
    threadId?: string | null,
  ) {
    const who = store.actor(threadId).id;
    switch (input.action) {
      case 'todo_create': {
        const { action, ...v } = input;
        return changed(store.todos.create(v, who));
      }
      case 'todo_update': {
        const { action, ...v } = input;
        return changed(store.todos.update(v, who));
      }
      case 'todo_bulk_prepare': {
        const { action, operation, ...v } = input;
        return store.todos.prepareBulk({ ...v, action: operation }, who);
      }
      case 'todo_bulk_apply':
        return changed(store.todos.applyBulk(input.id, who));
      case 'todos': {
        const { action, ...v } = input;
        return store.todos.list(v, who);
      }
      case 'channels':
        return { rooms: store.listRooms(who), me: store.actor(threadId) };
      case 'read':
        return store.snapshot(input.roomId, who);
      case 'history':
        return store.history(input, who);
      case 'files':
        return store.files(input, who);
      case 'create':
        return changed(store.createRoom(input, who));
      case 'send':
        return changed(store.send(input, who));
      case 'search':
        return store.search(input.query, false, who);
      case 'react':
        return changed(store.react(input.id, input.emoji, who));
    }
  }
  bb.agents.registerTool({
    name: 'vv_slack',
    description:
      'Use VV Slack: list channels, read or page through conversation and thread history, create channels or DMs, search, send messages or threaded replies, toggle reactions, and manage your personal to-dos with todos/todo_create/todo_update. Bulk changes use todo_bulk_prepare {operation:complete|saved|clear,status?,reminder?}, then todo_bulk_apply {id} with its reviewed preview ID; retries replay the receipt, and edited items require a new review. To-dos are private to your actual calling identity. history returns up to 100 messages with before/after cursors; parentId reads replies; around locates a message. files browses visible file metadata with optional query, type, roomId and before cursor; it excludes file bytes. Local VV workspace only. Use a stable UUID for each send; reuse it only for an identical uncertain submission. Your author identity is your actual BB thread. Messages do not automatically run another agent.',
    parameters: operations,
    execute: (input, context) =>
      JSON.stringify(execute(input, context.threadId)),
  });
  bb.agents.configure(() => ({ tools: ['vv_slack'], skills: ['vv-slack'] }));
  bb.cli.register({
    name: 'slack',
    summary: 'Read and post in VV channels and threads',
    commands: [
      {
        name: 'call',
        summary: 'Call a Slack operation with a JSON object',
        usage: 'bb slack call --input \'{"action":"channels"}\' --json',
      },
    ],
    async run(argv, ctx) {
      if (argv.includes('--help') || !argv.length)
        return {
          exitCode: 0,
          stdout:
            'bb slack call --input <JSON> [--json]\nActions: todo_bulk_prepare {operation:complete|saved|clear,status?,reminder?}, todo_bulk_apply {id}, todos {destination?,status?,reminder?,sort?,offset?}, todo_create {id,text|messageId,dueAt?}, todo_update {id,text?,dueAt?,completed?,destination?}, channels, read {roomId}, history {roomId,parentId?,before?|after?|around?}, files {query?,type?,roomId?,before?}, create {name,description?,recipient?}, send {id,roomId,text,parentId?,rich?,attachment?}, search {query}, react {id,emoji}.\nHistory returns 100 messages and before/after cursors. A send requires a UUID; retry an uncertain send with the same ID and identical content. Local VV only. No agent starts automatically.',
        };
      try {
        const index = argv.indexOf('--input');
        if (
          argv[0] !== 'call' ||
          index < 0 ||
          !argv[index + 1] ||
          argv.some(
            (a, i) =>
              i !== 0 && i !== index && i !== index + 1 && a !== '--json',
          )
        )
          throw new Error('Use slack call --input <JSON> [--json].');
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            execute(
              operations.parse(JSON.parse(argv[index + 1])),
              ctx.threadId,
            ),
          ),
        };
      } catch (error) {
        return {
          exitCode: 1,
          stdout: JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    },
  });
}
