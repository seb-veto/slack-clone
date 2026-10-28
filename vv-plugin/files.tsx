import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from '@get-bb/plugin-sdk/app';
import { Files as FilesIcon, Search } from 'lucide-react';
import type { z } from 'zod';
import {
  rpcContract,
  filesInput,
  type Message,
  type Member,
  type Room,
  type file,
} from './contract.ts';
import { Attachment } from './attachment.tsx';

type Page = { messages: Message[]; next: string | null };
export function Files({
  roomId,
  rooms,
  members,
  onOpen,
  onDownload,
  onPreview,
}: {
  roomId?: string;
  rooms: Room[];
  members: Member[];
  onOpen: (message: Message) => void;
  onDownload: (message: Message) => void;
  onPreview: (value: z.infer<typeof file>) => void;
}) {
  const rpc = useRpc<typeof rpcContract>(),
    connection = useRealtimeConnectionState();
  const [draft, setDraft] = useState(''),
    [query, setQuery] = useState('');
  const [type, setType] = useState<z.infer<typeof filesInput>['type']>('all');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [data, setData] = useState<{ key: string; page: Page }>();
  const [error, setError] = useState('');
  const version = useRef(0);
  const key = JSON.stringify({
    query,
    type,
    roomId,
    before: cursors.at(-1) ?? undefined,
  });
  const refresh = useCallback(async () => {
    const request = ++version.current;
    try {
      const page = await rpc.call(
        'files',
        JSON.parse(key) as z.input<typeof filesInput>,
      );
      if (request === version.current) {
        setData({ key, page });
        setError('');
      }
    } catch (e) {
      if (request === version.current) setError(String(e));
    }
  }, [rpc, key]);
  useEffect(() => {
    void refresh();
    return () => {
      version.current++;
    };
  }, [refresh, connection]);
  useRealtime('changed', () => {
    void refresh();
  });
  const page = data?.key === key ? data.page : null;
  const roomName = (message: Message) => {
    const room = rooms.find((r) => r.id === message.roomId);
    return room ? `${room.recipient ? '' : '#'}${room.name}` : 'Conversation';
  };
  return (
    <section
      className="slack-files"
      aria-label={roomId ? 'Channel files' : 'Files'}
    >
      {!roomId && (
        <header className="slack-channel-header">
          <h1>All files</h1>
        </header>
      )}
      <form
        className="slack-files-filters"
        role="search"
        aria-label="Search files"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
          setCursors([null]);
        }}
      >
        <label className="slack-files-search">
          <Search size={18} />
          <span className="slack-sr">Search files by name</span>
          <input
            type="search"
            maxLength={200}
            value={draft}
            placeholder="Search files"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button
          type="submit"
          title="Search files"
          aria-describedby="slack-key-help"
        >
          Search
        </button>
        <label>
          Types{' '}
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as typeof type);
              setCursors([null]);
            }}
          >
            <option value="all">All types</option>
            <option value="images">Images</option>
            <option value="pdfs">PDFs</option>
            <option value="text">Text files</option>
          </select>
        </label>
      </form>
      {error && (
        <p className="slack-error" role="alert">
          {error}{' '}
          <button
            type="button"
            title="Retry loading files"
            aria-describedby="slack-key-help"
            onClick={() => void refresh()}
          >
            Try again
          </button>
        </p>
      )}
      {!page && !error && (
        <p className="slack-files-loading" role="status">
          Loading files…
        </p>
      )}
      {page && (
        <div className="slack-files-scroll">
          {page.messages.length ? (
            <div className="slack-files-list">
              {page.messages.map((message) => (
                <article
                  className="slack-file-card"
                  key={message.id}
                  aria-label={message.attachment?.name}
                >
                  <Attachment
                    message={message}
                    onDownload={() => onDownload(message)}
                    onPreview={onPreview}
                  />
                  <div className="slack-file-context">
                    <strong>
                      {members.find((m) => m.id === message.author)?.name ??
                        'Teammate'}
                    </strong>
                    <span>
                      {new Date(message.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="slack-file-conversation"
                    title="Open original message"
                    aria-label={`Open ${message.attachment?.name} in ${roomName(message)}`}
                    aria-describedby="slack-key-help"
                    onClick={() => onOpen(message)}
                  >
                    {roomName(message)}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="slack-empty">
              <FilesIcon size={40} />
              <h2>
                {query || type !== 'all'
                  ? 'No matching files'
                  : 'Your files, all in one place'}
              </h2>
              <p>
                {query || type !== 'all'
                  ? 'Try another name or file type.'
                  : 'Files shared in conversations you can access will appear here.'}
              </p>
            </div>
          )}
          {(cursors.length > 1 || page.next) && (
            <nav className="slack-files-pages" aria-label="File pages">
              {cursors.length > 1 && (
                <button
                  type="button"
                  title="Show newer files"
                  aria-describedby="slack-key-help"
                  onClick={() => setCursors((value) => value.slice(0, -1))}
                >
                  Newer files
                </button>
              )}
              {page.next && (
                <button
                  type="button"
                  title="Show older files"
                  aria-describedby="slack-key-help"
                  onClick={() => setCursors((value) => [...value, page.next])}
                >
                  Older files
                </button>
              )}
            </nav>
          )}
        </div>
      )}
    </section>
  );
}
