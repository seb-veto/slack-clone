import { z } from 'zod';
import { defineRpcContract } from '@get-bb/plugin-sdk';

export * from './message-contract.ts';
import {
  id,
  roomInput,
  sendInput,
  message,
  room,
  member,
  delta,
  file,
} from './message-contract.ts';
import { todoCreate, todoUpdate, todoList, todo } from './todo-contract.ts';
export { todoCreate, todoUpdate, todoList, todo } from './todo-contract.ts';
export type { Todo } from './todo-contract.ts';
export const historyInput = z
  .object({
    roomId: id,
    parentId: id.optional(),
    before: id.optional(),
    after: id.optional(),
    around: id.optional(),
  })
  .refine(
    (v) => [v.before, v.after, v.around].filter(Boolean).length <= 1,
    'Choose one history cursor.',
  );
export const historyPage = z.object({
  messages: z.array(message),
  parent: message.nullable(),
  before: id.nullable(),
  after: id.nullable(),
});
export type HistoryPage = z.infer<typeof historyPage>;
export const filesInput = z.object({
  query: z.string().trim().max(200).default(''),
  type: z.enum(['all', 'images', 'pdfs', 'text']).default('all'),
  roomId: id.optional(),
  before: id.optional(),
});
export const assistantSession = z.object({
  requestId: z.string().uuid(),
  roomId: id,
  threadId: id.nullable(),
  error: z.string().nullable(),
  sharedMessages: z.number().int().nonnegative(),
});
// The BB SDK validates environment and prompt details before dispatch.
export const assistantRequest = z.object({
  projectId: id,
  providerId: id,
  model: id,
  reasoningLevel: z.string().max(80),
  serviceTier: z.string().max(80).optional(),
  permissionMode: z.enum(['accept-edits', 'auto', 'full']),
  environment: z.json(),
  input: z.array(z.json()).min(1).max(100),
  executionInputSources: z.json(),
  sessionOptions: z.json().optional(),
});
export const rpcContract = defineRpcContract({
  todoList: {
    input: todoList,
    output: z.object({
      items: z.array(todo),
      total: z.number(),
      nextOffset: z.number().nullable(),
    }),
  },
  todoCreate: { input: todoCreate, output: todo },
  todoUpdate: { input: todoUpdate, output: todo },
  todoDueCount: { input: z.object({}), output: z.number().int().nonnegative() },

  files: {
    input: filesInput,
    output: z.object({ messages: z.array(message), next: id.nullable() }),
  },
  history: { input: historyInput, output: historyPage },
  assistant: {
    input: z.object({ roomId: id }),
    output: assistantSession.nullable(),
  },
  startAssistant: {
    input: z.object({
      requestId: z.string().uuid(),
      roomId: id,
      request: assistantRequest,
    }),
    output: assistantSession,
  },
  snapshot: {
    input: z.object({ roomId: id.nullable().default(null) }),
    output: z.object({
      workspace: z.string(),
      me: member,
      members: z.array(member),
      rooms: z.array(room),
      messages: z.array(message),
    }),
  },
  createRoom: { input: roomInput, output: room },
  send: { input: sendInput, output: message },
  edit: {
    input: z.object({
      id,
      text: z.string().trim().min(1).max(30000),
      rich: delta.nullable().default(null),
    }),
    output: message,
  },
  remove: { input: z.object({ id }), output: z.object({ ok: z.boolean() }) },
  react: {
    input: z.object({ id, emoji: z.string().min(1).max(20) }),
    output: message,
  },
  save: { input: z.object({ id }), output: message },
  search: {
    input: z.object({
      query: z.string().trim().min(1).max(200),
      saved: z.boolean().default(false),
    }),
    output: z.array(message),
  },
  markRead: {
    input: z.object({ roomId: id, through: z.number().nonnegative() }),
    output: z.object({ ok: z.boolean() }),
  },
  draft: {
    input: z.object({
      key: z.string().max(350),
      value: delta.nullable().optional(),
    }),
    output: delta.nullable(),
  },
  settings: {
    input: z.object({
      workspace: z.string().trim().min(1).max(80),
      name: z.string().trim().min(1).max(80),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  attachment: { input: z.object({ id }), output: file },
});
