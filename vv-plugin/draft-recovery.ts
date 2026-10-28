import { delta } from './contract.ts';
import type { z } from 'zod';
export type Draft = z.infer<typeof delta> | null;
const cacheKey = (key: string) => `vv-slack:pending-draft:${key}`;
export function recoverDraft(
  storage: Pick<Storage, 'getItem'>,
  key: string,
): { value: Draft } | undefined {
  try {
    const raw = storage.getItem(cacheKey(key));
    if (raw === null) return;
    const parsed = delta.nullable().safeParse(JSON.parse(raw));
    if (parsed.success) return { value: parsed.data };
  } catch {
    /* The server draft remains available when browser storage is unavailable. */
  }
}
export function retainDraft(
  storage: Pick<Storage, 'setItem'>,
  key: string,
  value: Draft,
) {
  storage.setItem(cacheKey(key), JSON.stringify(value));
}
export function acknowledgeDraft(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  key: string,
  value: Draft,
) {
  if (storage.getItem(cacheKey(key)) === JSON.stringify(value))
    storage.removeItem(cacheKey(key));
}
