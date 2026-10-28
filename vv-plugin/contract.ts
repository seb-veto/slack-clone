import { z } from 'zod';
import { defineRpcContract } from '@get-bb/plugin-sdk';

export const id = z.string().min(1).max(160);
export const roomInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(1000).default(''),
  recipient: id.optional(),
});
const attributes = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    blockquote: z.boolean().optional(),
    indent: z.number().int().min(0).max(8).optional(),
    strike: z.boolean().optional(),
    code: z.boolean().optional(),
    link: z
      .string()
      .max(2048)
      .url()
      .regex(/^https?:\/\//i)
      .optional(),
    list: z.enum(['ordered', 'bullet']).optional(),
    'code-block': z.union([z.boolean(), z.string().max(30)]).optional(),
  })
  .strict();
export const delta = z
  .object({
    ops: z
      .array(
        z
          .object({
            insert: z.string().max(30000),
            attributes: attributes.optional(),
          })
          .strict(),
      )
      .max(2000),
  })
  .refine(
    (v) => v.ops.reduce((count, op) => count + op.insert.length, 0) <= 30001,
    'Formatted messages must be 30,000 characters or fewer.',
  );
export const file = z.object({
  name: z.string().min(1).max(200),
  mime: z.enum([
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'application/pdf',
  ]),
  data: z
    .string()
    .max(2800000)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
export const sendInput = z
  .object({
    id: z.string().uuid(),
    roomId: id,
    text: z.string().max(30000),
    rich: delta.nullable().default(null),
    parentId: id.nullable().default(null),
    attachment: file.nullable().default(null),
  })
  .refine(
    (v) => v.text.trim().length > 0 || v.attachment !== null,
    'Write a message or attach a file.',
  );
export const member = z.object({
  id,
  name: z.string(),
  kind: z.enum(['human', 'agent']),
});
export const room = z.object({
  id,
  name: z.string(),
  description: z.string(),
  createdAt: z.number(),
  recipient: id.nullable(),
  creator: id,
  unread: z.number(),
});
export const message = z.object({
  id,
  roomId: id,
  author: id,
  text: z.string(),
  rich: delta.nullable(),
  parentId: id.nullable(),
  createdAt: z.number(),
  editedAt: z.number().nullable(),
  deleted: z.boolean(),
  attachment: z.object({ name: z.string(), mime: z.string() }).nullable(),
  reactions: z.array(z.object({ emoji: z.string(), members: z.array(id) })),
  saved: z.boolean(),
  replyCount: z.number().int().nonnegative().default(0),
  lastReply: z
    .object({ author: id, createdAt: z.number() })
    .nullable()
    .default(null),
});
export type Member = z.infer<typeof member>;
export type Room = z.infer<typeof room>;
export type Message = z.infer<typeof message>;
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
