import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  definePluginApp,
  useRpc,
  useRealtime,
  useRealtimeConnectionState,
} from '@get-bb/plugin-sdk/app';
import {
  ArrowLeft,
  ArrowRight,
  Search,
  Home,
  MessagesSquare,
  Bell,
  Bookmark,
  Settings,
  HelpCircle,
  Hash,
  ChevronDown,
  Plus,
  X,
  MessageSquareText,
  Pencil,
  Bot,
  Users,
  Download,
  Check,
  FileText,
} from 'lucide-react';
import type { z } from 'zod';
import {
  rpcContract,
  type Message,
  type Room,
  type Member,
  type delta,
} from './contract.ts';
import {
  IconButton,
  WorkspaceSection,
  ChannelHero,
  Toolbar,
  Reactions,
  ThreadBar,
  RichText,
  Editor,
} from './components.tsx';
import './app.css';
type Snapshot = {
  workspace: string;
  me: Member;
  members: Member[];
  rooms: Room[];
  messages: Message[];
};
type Mode = 'home' | 'dms' | 'activity' | 'saved' | 'threads';
type Modal =
  'channel' | 'dm' | 'settings' | 'help' | 'details' | 'search' | null;

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      className="slack-dialog"
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </header>
      {children}
    </dialog>
  );
}
function Composer({
  roomId,
  parentId,
  name,
  rpc,
  refresh,
}: {
  roomId: string;
  parentId: string | null;
  name: string;
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  refresh: () => Promise<void>;
}) {
  const key = `${roomId}|${parentId ?? 'main'}`;
  const [draft, setDraft] = useState<
      z.infer<typeof delta> | null | undefined
    >(),
    [error, setError] = useState('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let live = true;
    void rpc
      .call('draft', { key })
      .then((v) => {
        if (live) setDraft(v);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [rpc, key]);
  if (draft === undefined)
    return (
      <div className="slack-composer-loading" role="status">
        {error || 'Loading draft…'}
      </div>
    );
  return (
    <>
      <Editor
        initial={draft}
        placeholder={parentId ? 'Reply…' : `Message ${name}`}
        onDraft={(value) => {
          queue.current = queue.current
            .catch(() => {})
            .then(() => rpc.call('draft', { key, value }))
            .then(() => setError(''))
            .catch(() =>
              setError(
                'Draft could not be saved. Keep this conversation open.',
              ),
            );
        }}
        onSubmit={async (v) => {
          await rpc.call('send', { ...v, roomId, parentId });
          await refresh();
        }}
      />
      {error && (
        <p className="slack-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
function Slack() {
  const rpc = useRpc<typeof rpcContract>(),
    connection = useRealtimeConnectionState();
  const [data, setData] = useState<Snapshot | null>(null),
    [roomId, setRoomId] = useState('general'),
    [mode, setMode] = useState<Mode>('home'),
    [threadId, setThreadId] = useState<string | null>(null),
    [modal, setModal] = useState<Modal>(null),
    [error, setError] = useState('');
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<Message[]>([]),
    [searched, setSearched] = useState(false),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Message | null>(null),
    [editText, setEditText] = useState(''),
    [deleting, setDeleting] = useState<Message | null>(null),
    [reactionId, setReactionId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState(''),
    [description, setDescription] = useState(''),
    [workspace, setWorkspace] = useState(''),
    [name, setName] = useState('');
  const [history, setHistory] = useState(['general']),
    [historyAt, setHistoryAt] = useState(0);
  const root = useRef<HTMLElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    wasNearBottom = useRef(true);
  const refresh = useCallback(async () => {
    const next = await rpc.call('snapshot', { roomId });
    setData(next);
  }, [rpc, roomId]);
  useEffect(() => {
    let live = true;
    void refresh().catch((e) => {
      if (live) setError(String(e));
    });
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [refresh, connection]);
  useRealtime('changed', () => {
    void refresh().catch((e) => setError(String(e)));
  });
  const room = data?.rooms.find((r) => r.id === roomId),
    memberName = (id: string) =>
      data?.members.find((m) => m.id === id)?.name ?? 'Teammate';
  const currentMessages =
    data?.messages.filter((m) => m.roomId === roomId) ?? [];
  const parent = currentMessages.find((m) => m.id === threadId);
  const unread = data?.rooms.reduce((n, r) => n + r.unread, 0) ?? 0;
  useEffect(() => {
    if (
      room &&
      mode === 'home' &&
      currentMessages.length &&
      document.visibilityState === 'visible'
    ) {
      void rpc
        .call('markRead', {
          roomId,
          through: Math.max(...currentMessages.map((m) => m.createdAt)),
        })
        .catch(() => {});
    }
  }, [roomId, data, mode, rpc]);
  useEffect(() => {
    if (scroll.current && wasNearBottom.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [data?.messages.length, roomId]);
  const navigate = (id: string) => {
    if (id !== roomId) {
      const next = history.slice(0, historyAt + 1);
      next.push(id);
      setHistory(next);
      setHistoryAt(next.length - 1);
    }
    setRoomId(id);
    setThreadId(null);
    setMode('home');
    wasNearBottom.current = true;
  };
  const changeHistory = (offset: number) => {
    const at = historyAt + offset;
    if (at < 0 || at >= history.length) return;
    setHistoryAt(at);
    setRoomId(history[at]);
    setThreadId(null);
    setMode('home');
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!root.current?.contains(event.target as Node)) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        ['b', 'i'].includes(event.key.toLowerCase()) &&
        (event.target as HTMLElement).closest('.ql-editor')
      )
        event.stopPropagation();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setModal('search');
      }
      if (event.key === 'Escape') {
        if (modal) return;
        setThreadId(null);
        setReactionId(null);
      }
    };
    const el = root.current;
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
  }, [modal]);
  async function act<T>(fn: () => Promise<T>) {
    setError('');
    try {
      const result = await fn();
      await refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }
  async function find(saved = false) {
    setBusy(true);
    setSearched(false);
    try {
      setResults(
        await rpc.call('search', { query: saved ? '*' : query.trim(), saved }),
      );
      setSearched(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (mode === 'saved') void find(true);
  }, [mode, data?.messages]);
  function openSettings() {
    setWorkspace(data?.workspace ?? 'VV');
    setName(data?.me.name ?? 'You');
    setModal('settings');
  }
  async function download(m: Message) {
    await act(async () => {
      const file = await rpc.call('attachment', { id: m.id });
      const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  }
  function messageCard(m: Message, inThread = false) {
    const author = data?.members.find((a) => a.id === m.author),
      replies = currentMessages.filter((x) => x.parentId === m.id);
    return (
      <article
        className={`slack-message ${m.deleted ? 'slack-deleted' : ''}`}
        key={m.id}
        aria-label={`Message from ${author?.name ?? 'teammate'}`}
      >
        <div
          className={`slack-avatar ${author?.kind === 'agent' ? 'slack-avatar-agent' : ''}`}
          aria-hidden="true"
        >
          {author?.kind === 'agent' ? (
            <Bot size={21} />
          ) : (
            (author?.name.charAt(0).toUpperCase() ?? 'V')
          )}
        </div>
        <div className="slack-message-body">
          <div className="slack-byline">
            <strong>{author?.name ?? 'Teammate'}</strong>
            {author?.kind === 'agent' && (
              <span className="slack-app-badge">APP</span>
            )}
            <time
              dateTime={new Date(m.createdAt).toISOString()}
              title={new Date(m.createdAt).toLocaleString()}
            >
              {new Date(m.createdAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </time>
          </div>
          {m.deleted ? (
            <p className="slack-muted">This message was deleted.</p>
          ) : (
            <>
              <RichText message={m} />
              {m.editedAt && <span className="slack-edited">(edited)</span>}
              {m.attachment && (
                <button
                  className="slack-file"
                  type="button"
                  title="Download attachment"
                  aria-describedby="slack-key-help"
                  onClick={() => void download(m)}
                >
                  <FileText size={26} />
                  <span>
                    <strong>{m.attachment.name}</strong>
                    <small>{m.attachment.mime}</small>
                  </span>
                  <Download size={16} />
                </button>
              )}
              <Reactions
                message={m}
                me={data?.me.id ?? 'human'}
                onChange={(emoji) =>
                  void act(() => rpc.call('react', { id: m.id, emoji }))
                }
              />
              {!inThread && (
                <ThreadBar
                  count={replies.length}
                  name={memberName(replies.at(-1)?.author ?? m.author)}
                  timestamp={replies.at(-1)?.createdAt ?? m.createdAt}
                  onClick={() => setThreadId(m.id)}
                />
              )}
              <Toolbar
                own={m.author === data?.me.id}
                saved={m.saved}
                onEdit={() => {
                  setEditing(m);
                  setEditText(m.text);
                }}
                onDelete={() => setDeleting(m)}
                onThread={() => setThreadId(m.parentId ?? m.id)}
                onReaction={() => setReactionId(m.id)}
                onSave={() => void act(() => rpc.call('save', { id: m.id }))}
              />
            </>
          )}
        </div>
      </article>
    );
  }
  if (!data)
    return (
      <section className="vv-slack slack-loading" aria-label="Slack">
        <MessagesSquare size={36} />
        <p role={error ? 'alert' : 'status'}>
          {error || 'Opening your workspace…'}
        </p>
        {error && <button onClick={() => void act(refresh)}>Try again</button>}
      </section>
    );
  return (
    <section className="vv-slack" aria-label="Slack" ref={root}>
      <div className="slack-topbar">
        <div className="slack-history">
          <IconButton
            label="Back"
            disabled={historyAt === 0}
            onClick={() => changeHistory(-1)}
          >
            <ArrowLeft size={18} />
          </IconButton>
          <IconButton
            label="Forward"
            disabled={historyAt === history.length - 1}
            onClick={() => changeHistory(1)}
          >
            <ArrowRight size={18} />
          </IconButton>
        </div>
        <button
          className="slack-top-search"
          type="button"
          title="Search workspace"
          aria-describedby="slack-key-help"
          onClick={() => setModal('search')}
        >
          <Search size={16} />
          <span>Search {data.workspace}</span>
          <kbd>⌘ K</kbd>
        </button>
        <IconButton label="Keyboard shortcuts" onClick={() => setModal('help')}>
          <HelpCircle size={19} />
        </IconButton>
      </div>
      <div className="slack-layout">
        <nav className="slack-rail" aria-label="Workspace navigation">
          <button
            className="slack-workspace-icon"
            type="button"
            title="Workspace settings"
            aria-label="Workspace settings"
            aria-describedby="slack-key-help"
            onClick={openSettings}
          >
            {data.workspace.charAt(0).toUpperCase()}
          </button>
          {(
            [
              { id: 'home', label: 'Home', icon: Home },
              { id: 'dms', label: 'DMs', icon: MessagesSquare },
              { id: 'activity', label: 'Activity', icon: Bell },
              { id: 'saved', label: 'Later', icon: Bookmark },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.id}
              title={item.label}
              aria-current={mode === item.id ? 'page' : undefined}
              aria-describedby="slack-key-help"
              className={`slack-rail-item ${mode === item.id || (item.id === 'home' && mode === 'threads') ? 'is-current' : ''}`}
              onClick={() => setMode(item.id)}
            >
              <span>
                <item.icon size={22} />
                {item.id === 'activity' && unread > 0 && (
                  <b className="slack-rail-unread">{unread}</b>
                )}
              </span>
              {item.label}
            </button>
          ))}
          <div className="slack-rail-bottom">
            <IconButton label="Workspace settings" onClick={openSettings}>
              <Settings size={21} />
            </IconButton>
            <button
              type="button"
              className="slack-profile"
              title="Your profile"
              aria-label="Your profile"
              aria-describedby="slack-key-help"
              onClick={openSettings}
            >
              {data.me.name.charAt(0)}
            </button>
          </div>
        </nav>
        <aside
          className="slack-sidebar"
          aria-label="Channels and direct messages"
        >
          <div className="slack-workspace-header">
            <button
              type="button"
              title="Workspace settings"
              aria-describedby="slack-key-help"
              onClick={openSettings}
            >
              <strong>{data.workspace}</strong>
              <ChevronDown size={16} />
            </button>
            <IconButton label="New conversation" onClick={() => setModal('dm')}>
              <Pencil size={18} />
            </IconButton>
          </div>
          <div className="slack-sidebar-links">
            <button
              type="button"
              title="View channel threads"
              aria-describedby="slack-key-help"
              className={mode === 'threads' ? 'selected' : ''}
              onClick={() => setMode('threads')}
            >
              <MessageSquareText size={16} />
              Threads
            </button>
            <button
              type="button"
              title="Show unread conversations"
              aria-describedby="slack-key-help"
              onClick={() => setMode('activity')}
            >
              <Bell size={16} />
              Unreads {unread > 0 && <b>{unread}</b>}
            </button>
          </div>
          <WorkspaceSection
            label="Channels"
            onNew={() => {
              setRoomName('');
              setDescription('');
              setModal('channel');
            }}
          >
            {data.rooms
              .filter((r) => !r.recipient)
              .map((r) => (
                <button
                  type="button"
                  title={`Open #${r.name}`}
                  aria-describedby="slack-key-help"
                  key={r.id}
                  className={`slack-channel ${roomId === r.id && mode === 'home' ? 'selected' : ''} ${r.unread ? 'has-unread' : ''}`}
                  onClick={() => navigate(r.id)}
                >
                  <Hash size={17} />
                  <span>{r.name}</span>
                  {r.unread > 0 && <b>{r.unread}</b>}
                </button>
              ))}
            <button
              type="button"
              className="slack-channel slack-add"
              title="Add channel"
              aria-describedby="slack-key-help"
              onClick={() => {
                setRoomName('');
                setDescription('');
                setModal('channel');
              }}
            >
              <Plus size={17} />
              <span>Add channels</span>
            </button>
          </WorkspaceSection>
          <WorkspaceSection
            label="Direct messages"
            onNew={() => setModal('dm')}
          >
            {data.rooms
              .filter((r) => r.recipient)
              .map((r) => (
                <button
                  type="button"
                  title={`Open ${r.name}`}
                  aria-describedby="slack-key-help"
                  className={`slack-channel ${roomId === r.id && mode === 'home' ? 'selected' : ''}`}
                  key={r.id}
                  onClick={() => navigate(r.id)}
                >
                  <Bot size={17} />
                  <span>{r.name}</span>
                  {r.unread > 0 && <b>{r.unread}</b>}
                </button>
              ))}
            <button
              type="button"
              className="slack-channel slack-add"
              title="Find a teammate"
              aria-describedby="slack-key-help"
              onClick={() => setModal('dm')}
            >
              <Plus size={17} />
              <span>Add teammates</span>
            </button>
          </WorkspaceSection>
          <div className="slack-sidebar-foot">Your team, together in VV.</div>
        </aside>
        <main className="slack-main">
          {(mode === 'home' || mode === 'threads') && room ? (
            <>
              <header className="slack-channel-header">
                <button
                  type="button"
                  title="Conversation details"
                  aria-describedby="slack-key-help"
                  onClick={() => setModal('details')}
                >
                  {room.recipient ? <Bot size={22} /> : <Hash size={22} />}
                  <strong>{room.recipient ? room.name : room.name}</strong>
                  <ChevronDown size={15} />
                </button>
                <div className="slack-header-members">
                  <Users size={16} />
                  <span>{room.recipient ? 2 : data.members.length}</span>
                </div>
              </header>
              <div className="slack-channel-tabs">
                <span className="active-tab">Messages</span>
                {connection !== 'connected' && (
                  <span role="status">Reconnecting…</span>
                )}
              </div>
              <div
                className="slack-message-scroll"
                ref={scroll}
                onScroll={() => {
                  if (scroll.current)
                    wasNearBottom.current =
                      scroll.current.scrollHeight -
                        scroll.current.scrollTop -
                        scroll.current.clientHeight <
                      90;
                }}
              >
                {mode === 'threads' ? (
                  <>
                    <h2 className="slack-list-title">
                      Threads in {room.recipient ? room.name : `#${room.name}`}
                    </h2>
                    {currentMessages
                      .filter(
                        (m) =>
                          !m.parentId &&
                          currentMessages.some((r) => r.parentId === m.id),
                      )
                      .map((m) => messageCard(m))}
                    {!currentMessages.some((m) => m.parentId) && (
                      <div className="slack-empty">
                        <MessageSquareText size={36} />
                        <h2>A little more room to talk</h2>
                        <p>
                          Reply to a message in a thread to keep the
                          conversation organized.
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {room.recipient ? (
                      <div className="slack-hero">
                        <div className="slack-avatar slack-avatar-agent">
                          <Bot size={30} />
                        </div>
                        <h1>{room.name}</h1>
                        <p>
                          This conversation is between you and {room.name}.
                          Messages stay in VV.
                        </p>
                      </div>
                    ) : (
                      <ChannelHero
                        name={room.name}
                        description={room.description}
                        createdAt={room.createdAt}
                      />
                    )}
                    <div className="slack-date-rule">
                      <span>
                        {currentMessages.length
                          ? new Date(
                              currentMessages[0].createdAt,
                            ).toLocaleDateString(undefined, {
                              month: 'long',
                              day: 'numeric',
                            })
                          : 'Today'}
                      </span>
                    </div>
                    {currentMessages
                      .filter((m) => !m.parentId)
                      .map((m) => messageCard(m))}
                  </>
                )}
              </div>
              {mode === 'home' && (
                <Composer
                  key={roomId}
                  roomId={roomId}
                  parentId={null}
                  name={room.recipient ? room.name : `#${room.name}`}
                  rpc={rpc}
                  refresh={refresh}
                />
              )}
            </>
          ) : (
            <>
              <header className="slack-channel-header">
                <h1>
                  {mode === 'dms'
                    ? 'Direct messages'
                    : mode === 'activity'
                      ? 'Activity'
                      : 'Later'}
                </h1>
                {mode === 'dms' && (
                  <IconButton
                    label="New direct message"
                    onClick={() => setModal('dm')}
                  >
                    <Plus size={20} />
                  </IconButton>
                )}
              </header>
              <div className="slack-message-scroll">
                {mode === 'saved' ? (
                  results.length ? (
                    results.map((m) => (
                      <div className="slack-result" key={m.id}>
                        {messageCard(m, true)}
                        <button
                          type="button"
                          title="Open conversation"
                          aria-describedby="slack-key-help"
                          onClick={() => {
                            navigate(m.roomId);
                            setThreadId(m.parentId ?? null);
                          }}
                        >
                          Open conversation →
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="slack-empty">
                      <Bookmark size={40} />
                      <h2>Save it for a little later</h2>
                      <p>Save a message to come back to it here.</p>
                    </div>
                  )
                ) : (
                  <>
                    {data.rooms
                      .filter((r) =>
                        mode === 'dms' ? r.recipient : r.unread > 0,
                      )
                      .map((r) => (
                        <button
                          type="button"
                          className="slack-conversation-row"
                          title="Open conversation"
                          aria-describedby="slack-key-help"
                          key={r.id}
                          onClick={() => navigate(r.id)}
                        >
                          {r.recipient ? <Bot size={22} /> : <Hash size={22} />}
                          <strong>{r.name}</strong>
                          {r.unread > 0 && <span>{r.unread} unread</span>}
                        </button>
                      ))}
                    {!data.rooms.some((r) =>
                      mode === 'dms' ? r.recipient : r.unread > 0,
                    ) && (
                      <div className="slack-empty">
                        {mode === 'dms' ? (
                          <MessagesSquare size={40} />
                        ) : (
                          <Check size={40} />
                        )}
                        <h2>
                          {mode === 'dms'
                            ? 'Start a conversation'
                            : 'You’re all caught up'}
                        </h2>
                        <p>
                          {mode === 'dms'
                            ? 'Agents appear as teammates when they use the Slack tool.'
                            : 'New messages from your teammates will appear here.'}
                        </p>
                        {mode === 'dms' && (
                          <button
                            type="button"
                            title="Find a teammate"
                            aria-describedby="slack-key-help"
                            className="slack-primary"
                            onClick={() => setModal('dm')}
                          >
                            Find a teammate
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
          {error && (
            <div className="slack-error" role="alert">
              {error}
              <IconButton label="Dismiss error" onClick={() => setError('')}>
                <X size={15} />
              </IconButton>
            </div>
          )}
        </main>
        {threadId && parent && (
          <aside className="slack-thread" aria-label="Thread">
            <header className="slack-channel-header">
              <h2>
                Thread{' '}
                <small>{room?.recipient ? room.name : `#${room?.name}`}</small>
              </h2>
              <IconButton
                label="Close thread"
                onClick={() => setThreadId(null)}
              >
                <X size={20} />
              </IconButton>
            </header>
            <div className="slack-message-scroll">
              {messageCard(parent, true)}
              <div className="slack-reply-rule">
                {currentMessages.filter((m) => m.parentId === parent.id).length}{' '}
                replies
              </div>
              {currentMessages
                .filter((m) => m.parentId === parent.id)
                .map((m) => messageCard(m, true))}
            </div>
            <Composer
              key={threadId}
              roomId={roomId}
              parentId={threadId}
              name="thread"
              rpc={rpc}
              refresh={refresh}
            />
          </aside>
        )}
      </div>
      {modal && (
        <Dialog
          title={
            {
              channel: 'Create a channel',
              dm: 'Direct messages',
              settings: 'Workspace settings',
              help: 'Keyboard shortcuts',
              details: room?.recipient
                ? 'Conversation details'
                : `About #${room?.name}`,
              search: `Search ${data.workspace}`,
            }[modal]
          }
          onClose={() => setModal(null)}
        >
          {modal === 'channel' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                void act(() =>
                  rpc.call('createRoom', { name: roomName, description }),
                )
                  .then((r) => {
                    if (r) {
                      navigate(r.id);
                      setModal(null);
                    }
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <p>Channels bring people and agents together around a topic.</p>
              <label>
                Name
                <input
                  autoFocus
                  required
                  pattern="[a-z0-9][a-z0-9_-]*"
                  maxLength={80}
                  placeholder="e.g. project-launch"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
              </label>
              <label>
                Description
                <textarea
                  maxLength={1000}
                  placeholder="What’s this channel for?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <p className="slack-muted">
                Everyone using this VV workspace can read public channels.
              </p>
              <button
                className="slack-primary"
                title="Create channel"
                aria-describedby="slack-key-help"
                disabled={busy}
              >
                Create
              </button>
            </form>
          ) : modal === 'dm' ? (
            <div className="slack-dialog-body">
              <p>Choose a teammate to start or resume a direct conversation.</p>
              {data.members
                .filter((m) => m.id !== data.me.id)
                .map((m) => (
                  <button
                    type="button"
                    className="slack-conversation-row"
                    title="Start direct message"
                    aria-describedby="slack-key-help"
                    disabled={busy}
                    key={m.id}
                    onClick={() => {
                      setBusy(true);
                      void act(() =>
                        rpc.call('createRoom', {
                          name: m.name,
                          description: '',
                          recipient: m.id,
                        }),
                      )
                        .then((r) => {
                          if (r) {
                            navigate(r.id);
                            setModal(null);
                          }
                        })
                        .finally(() => setBusy(false));
                    }}
                  >
                    <Bot size={22} />
                    {m.name}
                  </button>
                ))}
              {data.members.length < 2 && (
                <p>
                  No teammates yet. Agents join when they use the{' '}
                  <code>vv_slack</code> tool. No agent starts automatically.
                </p>
              )}
            </div>
          ) : modal === 'settings' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                void act(() => rpc.call('settings', { workspace, name }))
                  .then((r) => {
                    if (r) setModal(null);
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                Workspace name
                <input
                  autoFocus
                  required
                  maxLength={80}
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                />
              </label>
              <label>
                Your display name
                <input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <p>
                Messages are stored in this VV workspace. This app does not
                connect to the Slack service.
              </p>
              <button
                className="slack-primary"
                title="Save workspace settings"
                aria-describedby="slack-key-help"
                disabled={busy}
              >
                Save
              </button>
            </form>
          ) : modal === 'help' ? (
            <div className="slack-dialog-body">
              <dl className="slack-shortcuts">
                <dt>Search conversations</dt>
                <dd>⌘ / Ctrl K</dd>
                <dt>Send a message</dt>
                <dd>Enter</dd>
                <dt>New line</dt>
                <dd>Shift Enter</dd>
                <dt>Bold / italic</dt>
                <dd>⌘ / Ctrl B / I</dd>
                <dt>Move between controls</dt>
                <dd>Tab / Shift Tab</dd>
                <dt>Activate a control</dt>
                <dd>Enter / Space</dd>
                <dt>Close a dialog or thread</dt>
                <dd>Escape</dd>
              </dl>
              <p>
                Hover or focus a message for reactions, replies, saving and your
                own edit/delete actions. Draft text is saved as you type. Files
                up to 2 MB can be attached.
              </p>
              <p>
                Built from the MIT-licensed Slack Clone by Sanidhya Kumar Verma.
                Local VV channels, not Slack network accounts. Huddles, Slack
                Connect, enterprise administration, canvases and external app
                integrations are not implemented.
              </p>
            </div>
          ) : modal === 'details' ? (
            <div className="slack-dialog-body">
              <h3>{room?.name}</h3>
              <p>{room?.description || 'No description yet.'}</p>
              <p>
                Created {new Date(room?.createdAt ?? 0).toLocaleDateString()}
              </p>
              <p>
                {room?.recipient
                  ? 'A direct conversation between its two VV members.'
                  : 'A public channel for everyone in this VV workspace.'}
              </p>
              <p>
                {room?.recipient
                  ? 'Posting does not automatically start the recipient agent.'
                  : `${data.members.length} teammates`}
              </p>
            </div>
          ) : (
            <div className="slack-dialog-body">
              <form
                className="slack-search-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void find();
                }}
              >
                <label className="slack-sr" htmlFor="slack-search">
                  Search messages
                </label>
                <Search size={18} />
                <input
                  ref={searchInput}
                  id="slack-search"
                  autoFocus
                  required
                  maxLength={200}
                  value={query}
                  placeholder="Search messages"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSearched(false);
                  }}
                />
                <button
                  type="submit"
                  title="Search messages"
                  aria-describedby="slack-key-help"
                  disabled={busy}
                >
                  Search
                </button>
              </form>
              {searched && <p>{results.length} results</p>}
              {searched &&
                results.map((m) => (
                  <button
                    type="button"
                    title="Open search result"
                    aria-describedby="slack-key-help"
                    className="slack-search-result"
                    key={m.id}
                    onClick={() => {
                      navigate(m.roomId);
                      setThreadId(m.parentId);
                      setModal(null);
                    }}
                  >
                    <strong>{memberName(m.author)}</strong>
                    <span>{m.text}</span>
                    <small>{new Date(m.createdAt).toLocaleString()}</small>
                  </button>
                ))}
            </div>
          )}
          {error && (
            <p role="alert" className="slack-error">
              {error}
            </p>
          )}
        </Dialog>
      )}
      {editing && (
        <Dialog title="Edit message" onClose={() => setEditing(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void act(() =>
                rpc.call('edit', {
                  id: editing.id,
                  text: editText,
                  rich: null,
                }),
              )
                .then((r) => {
                  if (r) setEditing(null);
                })
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Message
              <textarea
                autoFocus
                required
                maxLength={30000}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
              />
            </label>
            <p>Saving this edit replaces the text and its formatting.</p>
            <button
              className="slack-primary"
              title="Save message edit"
              aria-describedby="slack-key-help"
              disabled={busy}
            >
              Save changes
            </button>
            {error && <p role="alert">{error}</p>}
          </form>
        </Dialog>
      )}
      {deleting && (
        <Dialog title="Delete message?" onClose={() => setDeleting(null)}>
          <div className="slack-dialog-body">
            <p>
              This removes your message and attachment. Thread replies remain.
            </p>
            <blockquote>{deleting.text}</blockquote>
            <button
              type="button"
              className="slack-danger"
              title="Delete this message"
              aria-describedby="slack-key-help"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void act(() => rpc.call('remove', { id: deleting.id }))
                  .then((r) => {
                    if (r) setDeleting(null);
                  })
                  .finally(() => setBusy(false));
              }}
            >
              Delete
            </button>
            {error && <p role="alert">{error}</p>}
          </div>
        </Dialog>
      )}
      {reactionId && (
        <Dialog title="Add a reaction" onClose={() => setReactionId(null)}>
          <div className="slack-emoji-picker">
            {[
              '👍',
              '❤️',
              '🎉',
              '👀',
              '🙌',
              '✅',
              '🚀',
              '🙂',
              '😂',
              '💡',
              '🙏',
              '🔥',
            ].map((emoji) => (
              <button
                type="button"
                key={emoji}
                title={`React ${emoji}`}
                aria-label={`React ${emoji}`}
                aria-describedby="slack-key-help"
                onClick={() =>
                  void act(() =>
                    rpc.call('react', { id: reactionId, emoji }),
                  ).then((r) => {
                    if (r) setReactionId(null);
                  })
                }
              >
                {emoji}
              </button>
            ))}
          </div>
        </Dialog>
      )}
      <span id="slack-key-help" className="slack-sr">
        Use Tab to focus controls, then Enter or Space to activate. Escape
        closes dialogs and the thread pane. Actions save in this VV workspace.
      </span>
    </section>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'slack',
    title: 'Slack',
    icon: 'MessagesSquare',
    path: 'workspace',
    component: Slack,
  });
});
