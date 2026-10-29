import { z } from 'zod';
import { id, message } from './message-contract.ts';
export const dueDate = z.number().int().min(0).max(8640000000000000);
export const todoCreate = z
  .object({
    id: z.string().uuid(),
    messageId: id.nullable().default(null),
    text: z.string().trim().max(30000).default(''),
    dueAt: dueDate.nullable().default(null),
  })
  .strict()
  .refine(
    (v) => Boolean(v.messageId) !== Boolean(v.text),
    'Choose a message or enter details.',
  );
export const todoUpdate = z
  .object({
    id: z.string().uuid(),
    text: z.string().trim().min(1).max(30000).optional(),
    dueAt: dueDate.nullable().optional(),
    completed: z.boolean().optional(),
    destination: z.enum(['todos', 'saved', 'cleared']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, 'Choose a change.');
export const todoList = z.object({
  destination: z.enum(['todos', 'saved']).default('todos'),
  status: z.enum(['all', 'in_progress', 'completed']).default('all'),
  reminder: z.enum(['all', 'overdue', 'upcoming', 'none']).default('all'),
  sort: z.enum(['due', 'oldest', 'newest']).default('due'),
  offset: z.number().int().min(0).default(0),
});
export const todo = z.object({
  id: z.string().uuid(),
  text: z.string(),
  messageId: id.nullable(),
  message: message.nullable(),
  dueAt: dueDate.nullable(),
  completedAt: dueDate.nullable(),
  createdAt: dueDate,
  destination: z.enum(['todos', 'saved', 'cleared']),
});
export type Todo = z.infer<typeof todo>;
export const todoBulkPrepare = todoList
  .omit({ destination: true, sort: true, offset: true })
  .extend({ action: z.enum(['complete', 'saved', 'clear']) });
export const todoBulkPreview = z.object({
  id: z.string().uuid(),
  action: z.enum(['complete', 'saved', 'clear']),
  count: z.number().int().nonnegative(),
});
