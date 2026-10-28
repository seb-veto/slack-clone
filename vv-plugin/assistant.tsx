import { useEffect, useRef, useState } from 'react';
import {
  ThreadChat,
  experimental_NewThreadComposer as NewThreadComposer,
  useRpc,
} from '@get-bb/plugin-sdk/app';
import type { z } from 'zod';
import { Sparkles, X } from 'lucide-react';
import { assistantSession, rpcContract } from './contract.ts';
import { IconButton } from './components.tsx';

export function Assistant({
  roomId,
  name,
  onClose,
}: {
  roomId: string;
  name: string;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [session, setSession] = useState<
    z.infer<typeof assistantSession> | null | undefined
  >();
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    let live = true;
    void rpc
      .call('assistant', { roomId })
      .then((v) => {
        if (live) setSession(v);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [rpc, roomId]);
  return (
    <aside
      className="slack-thread slack-assistant"
      aria-label="Conversation assistant"
    >
      <header className="slack-channel-header">
        <h2>
          <Sparkles size={18} /> Assistant
        </h2>
        <IconButton label="Close assistant" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </header>
      <div className="slack-assistant-context">
        {session?.threadId
          ? `Continuing the BB conversation for ${name}. The initial shared snapshot contained ${session.sharedMessages} messages.`
          : `Ask about ${name}. Starting shares up to 30 recent message texts with the BB model you choose. Files are not shared.`}
      </div>
      {error && (
        <p role="alert" className="slack-error">
          {error}
        </p>
      )}
      {session === undefined ? (
        <p className="slack-assistant-loading" role="status">
          {error ? 'Could not load the conversation.' : 'Opening assistant…'}
        </p>
      ) : session?.threadId ? (
        <ThreadChat
          threadId={session.threadId}
          variant="compact"
          layout="contained"
          permissionPolicy="inherit"
          className="slack-assistant-chat slack-native"
        />
      ) : session ? (
        <div role="alert" className="slack-assistant-loading">
          {session.error ??
            'A creation request is pending. No second request will be sent.'}
        </div>
      ) : (
        <div className="slack-assistant-composer slack-native">
          <h3>What would you like to know?</h3>
          <p>
            Summarize this conversation, find a decision, or work through a
            question.
          </p>
          <NewThreadComposer
            layout="document"
            draftKey={`slack-assistant-${roomId}`}
            defaultProviderId="codex"
            defaultModel="gpt-6.1-sol"
            defaultReasoningLevel="medium"
            defaultServiceTier="default"
            defaultPermissionMode="accept-edits"
            placeholder="Ask about this conversation…"
            onSubmit={async (request) => {
              setError('');
              try {
                setSession(
                  await rpc.call('startAssistant', {
                    requestId: requestId.current,
                    roomId,
                    request: request as never,
                  }),
                );
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                );
                throw cause;
              }
            }}
          />
        </div>
      )}
    </aside>
  );
}
