import { z } from 'zod';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { rpcContract, id, roomInput, sendInput } from './contract.ts';
import { createStore } from './store.ts';
export { rpcContract } from './contract.ts';

export default function plugin(bb: BbPluginApi) {
  const store = createStore(bb);
  const changed = <T>(value: T): T => {
    bb.realtime.publish('changed', {});
    return value;
  };
  const human = store.actor().id;
  bb.rpc.register(rpcContract, {
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
    z.object({ action: z.literal('read'), roomId: id }),
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
      case 'channels':
        return { rooms: store.listRooms(who), me: store.actor(threadId) };
      case 'read':
        return store.snapshot(input.roomId, who);
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
      'Use VV Slack: list channels, read conversations, create channels or DMs, search, send messages or threaded replies, and toggle reactions. Local VV workspace only. Use a stable UUID for each send; reuse it only for an identical uncertain submission. Your author identity is your actual BB thread. Messages do not automatically run another agent.',
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
            'bb slack call --input <JSON> [--json]\nActions: channels, read {roomId}, create {name,description?,recipient?}, send {id,roomId,text,parentId?,rich?,attachment?}, search {query}, react {id,emoji}.\nA send requires a UUID; retry an uncertain send with the same ID and identical content. Local VV only. No agent starts automatically.',
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
