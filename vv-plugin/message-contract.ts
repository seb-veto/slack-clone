import { z } from 'zod';

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
  todoId: z.string().uuid().nullable().default(null),
  replyCount: z.number().int().nonnegative().default(0),
  lastReply: z
    .object({ author: id, createdAt: z.number() })
    .nullable()
    .default(null),
});
export type Member = z.infer<typeof member>;
export type Room = z.infer<typeof room>;
export type Message = z.infer<typeof message>;
