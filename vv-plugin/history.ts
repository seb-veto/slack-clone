import { useCallback, useRef, useState } from 'react';
import { useRpc } from '@get-bb/plugin-sdk/app';
import type { z } from 'zod';
import {
  rpcContract,
  historyInput,
  type HistoryPage,
  type Message,
} from './contract.ts';

type Cursor = { before?: string; after?: string; around?: string };
export function useConversationHistory(
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>,
  roomId: string,
  threadId: string | null,
) {
  const [cursor, setCursor] = useState<Cursor & { roomId: string }>({ roomId });
  const [replyCursor, setReplyCursor] = useState<Cursor & { parentId: string }>(
    { parentId: '' },
  );
  const key = JSON.stringify({
    roomId,
    ...(cursor.roomId === roomId ? cursor : {}),
  });
  const threadKey = threadId
    ? JSON.stringify({
        roomId,
        parentId: threadId,
        ...(replyCursor.parentId === threadId ? replyCursor : {}),
      })
    : null;
  const [timeline, setTimeline] = useState<{
    key: string;
    page: HistoryPage;
  }>();
  const [thread, setThread] = useState<{ key: string; page: HistoryPage }>();
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++version.current;
    const [page, replies] = await Promise.all([
      rpc.call('history', JSON.parse(key) as z.input<typeof historyInput>),
      threadKey
        ? rpc.call(
            'history',
            JSON.parse(threadKey) as z.input<typeof historyInput>,
          )
        : null,
    ]);
    if (request === version.current) {
      setTimeline({ key, page });
      setThread(
        replies && threadKey ? { key: threadKey, page: replies } : undefined,
      );
    }
  }, [rpc, key, threadKey]);
  const page = timeline?.key === key ? timeline.page : null;
  const replies = thread?.key === threadKey ? (thread?.page ?? null) : null;
  return {
    page,
    threadPage: replies,
    key,
    threadKey,
    anchor: cursor.roomId === roomId ? cursor.around : undefined,
    replyAnchor:
      replyCursor.parentId === threadId ? replyCursor.around : undefined,
    messages: page?.messages ?? [],
    parent: replies?.parent ?? page?.messages.find((m) => m.id === threadId),
    replies: replies?.messages ?? [],
    refresh,
    move: (value: Cursor) => setCursor({ roomId, ...value }),
    moveThread: (value: Cursor) =>
      setReplyCursor({ parentId: threadId ?? '', ...value }),
    locate: (message: Message) => {
      setCursor({
        roomId: message.roomId,
        around: message.parentId ?? message.id,
      });
      if (message.parentId)
        setReplyCursor({ parentId: message.parentId, around: message.id });
    },
  };
}
