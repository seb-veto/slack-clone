import {
  recoverDraft,
  retainDraft,
  acknowledgeDraft,
  type Draft,
} from './draft-recovery.ts';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  Check,
  Sparkles,
  Files as FilesIcon,
} from 'lucide-react';
import { Assistant } from './assistant.tsx';
import { useConversationHistory } from './history.ts';
import { Files as FilesView } from './files.tsx';
import { Directory, Profile } from './directory.tsx';
import { MoreNavigation } from './navigation.tsx';
import type { z } from 'zod';
import {
  rpcContract,
  type Message,
  type Room,
  type Member,
  type HistoryPage,
  type delta,
  type file,
} from './contract.ts';
import { Attachment } from './attachment.tsx';
import {
  IconButton,
  EmojiMenu,
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
type Mode =
  | 'home'
  | 'dms'
  | 'activity'
  | 'saved'
  | 'threads'
  | 'files'
  | 'directories';
type Modal =
  | 'channel'
  | 'dm'
  | 'settings'
  | 'help'
  | 'details'
  | 'search'
  | null;

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
  useLayoutEffect(() => {
    const el = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    const owner = el.closest<HTMLElement>('.vv-slack');
    el.showModal();
    el.querySelector<HTMLElement>(
      'input,textarea,[contenteditable="true"]',
    )?.focus();
    return () => {
      el.close();
      if (opener?.isConnected && opener !== document.body) opener.focus();
      else if (owner?.isConnected)
        owner.querySelector<HTMLButtonElement>('.slack-top-search')?.focus();
      queueMicrotask(() => {
        if (document.activeElement === document.body && owner?.isConnected)
          owner.querySelector<HTMLButtonElement>('.slack-top-search')?.focus();
      });
    };
  }, [title]);
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
function HistoryNavigation({
  page,
  name,
  onMove,
}: {
  page: HistoryPage | null;
  name: string;
  onMove: (cursor: { before?: string; after?: string }) => void;
}) {
  if (!page) return <p role="status">Loading messages…</p>;
  if (!page.before && !page.after) return null;
  return (
    <nav
      className="slack-history-navigation"
      aria-label={`${name} message history`}
    >
      {page.before && (
        <button
          type="button"
          title="Load older messages"
          aria-label={`Load older ${name} messages`}
          aria-describedby="slack-key-help"
          onClick={() => onMove({ before: page.before! })}
        >
          Older messages
        </button>
      )}
      {page.after && (
        <>
          <button
            type="button"
            title="Load newer messages"
            aria-label={`Load newer ${name} messages`}
            aria-describedby="slack-key-help"
            onClick={() => onMove({ after: page.after! })}
          >
            Newer messages
          </button>
          <button
            type="button"
            title="Jump to present"
            aria-label={`Jump to present in ${name}`}
            aria-describedby="slack-key-help"
            onClick={() => onMove({})}
          >
            Jump to present
          </button>
        </>
      )}
    </nav>
  );
}
function Composer({
  roomId,
  parentId,
  name,
  rpc,
  refresh,
  onSent,
}: {
  roomId: string;
  parentId: string | null;
  name: string;
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  refresh: () => Promise<void>;
  onSent: () => void;
}) {
  const key = `${roomId}|${parentId ?? 'main'}`;
  const [draft, setDraft] = useState<
      z.infer<typeof delta> | null | undefined
    >(),
    [error, setError] = useState('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function saveDraft(value: Draft) {
    try {
      retainDraft(localStorage, key, value);
    } catch {
      setError(
        'Local draft recovery unavailable. Keep this conversation open until saved.',
      );
    }
    queue.current = queue.current
      .catch(() => {})
      .then(() => rpc.call('draft', { key, value }))
      .then(() => {
        try {
          acknowledgeDraft(localStorage, key, value);
        } catch {
          /* Keep the recovery copy. */
        }
        setError('');
      })
      .catch(() =>
        setError('Draft could not be saved. Keep this conversation open.'),
      );
  }
  useEffect(() => {
    let live = true;
    const recovered = recoverDraft(localStorage, key);
    if (recovered) {
      setDraft(recovered.value);
      saveDraft(recovered.value);
    } else
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
        onDraft={saveDraft}
        onSubmit={async (v) => {
          await rpc.call('send', { ...v, roomId, parentId });
          onSent();
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
  const [preview, setPreview] = useState<z.infer<typeof file> | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const rpc = useRpc<typeof rpcContract>(),
    connection = useRealtimeConnectionState();
  const [data, setData] = useState<Snapshot | null>(null),
    [roomId, setRoomId] = useState(() => {
      try {
        const saved = localStorage.getItem('vv-slack:room');
        return saved && saved.length <= 160 ? saved : 'general';
      } catch {
        return 'general';
      }
    }),
    [mode, setMode] = useState<Mode>('home'),
    [threadId, setThreadId] = useState<string | null>(null),
    [modal, setModal] = useState<Modal>(null),
    [error, setError] = useState('');
  const conversation = useConversationHistory(rpc, roomId, threadId);
  const [conversationTab, setConversationTab] = useState<'messages' | 'files'>(
    'messages',
  );
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<Message[]>([]),
    [searched, setSearched] = useState(false),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Message | null>(null),
    [deleting, setDeleting] = useState<Message | null>(null),
    [reactionId, setReactionId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState(''),
    [description, setDescription] = useState(''),
    [workspace, setWorkspace] = useState(''),
    [name, setName] = useState('');
  const [history, setHistory] = useState([roomId]),
    [historyAt, setHistoryAt] = useState(0);
  const root = useRef<HTMLElement>(null),
    profileOrigin = useRef<HTMLElement | null>(null),
    searchInput = useRef<HTMLInputElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    replyScroll = useRef<HTMLDivElement>(null),
    wasNearBottom = useRef(true),
    repliesNearBottom = useRef(true),
    positionedPage = useRef(''),
    positionedThread = useRef<string | null>(null),
    refreshVersion = useRef(0);
  useEffect(() => {
    try {
      localStorage.setItem('vv-slack:room', roomId);
    } catch {
      /* Navigation still works when local storage is unavailable. */
    }
  }, [roomId]);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    let next: Snapshot;
    try {
      next = await rpc.call('snapshot', { roomId });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes('Conversation not available')
      )
        throw error;
      next = await rpc.call('snapshot', { roomId: 'general' });
      if (version === refreshVersion.current) {
        setRoomId('general');
        setThreadId(null);
        setData(next);
      }
      return;
    }
    if (version !== refreshVersion.current) return;
    await conversation.refresh();
    if (version === refreshVersion.current) setData(next);
  }, [rpc, roomId, conversation.refresh]);
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
  const profile = data?.members.find((member) => member.id === profileId);
  const room = data?.rooms.find((r) => r.id === roomId),
    memberName = (id: string) =>
      data?.members.find((m) => m.id === id)?.name ?? 'Teammate';
  const currentMessages = conversation.messages;
  const parent = conversation.parent;
  const unread = data?.rooms.reduce((n, r) => n + r.unread, 0) ?? 0;
  useLayoutEffect(() => {
    if (mode === 'home' && document.activeElement === document.body)
      root.current
        ?.querySelector<HTMLButtonElement>('.slack-main .slack-channel-header > button')
        ?.focus();
  }, [mode, roomId]);
  useEffect(() => {
    if (
      room &&
      mode === 'home' &&
      conversationTab === 'messages' &&
      currentMessages.length &&
      document.visibilityState === 'visible'
    ) {
      void rpc
        .call('markRead', {
          roomId,
          through: Math.max(
            ...[...currentMessages, ...conversation.replies].map(
              (m) => m.createdAt,
            ),
          ),
        })
        .catch(() => {});
    }
  }, [
    roomId,
    data,
    conversation.page,
    conversation.threadPage,
    conversationTab,
    mode,
    rpc,
  ]);
  useEffect(() => {
    if (
      !scroll.current ||
      !conversation.page ||
      (mode === 'home' && conversationTab !== 'messages')
    )
      return;
    if (conversation.anchor && positionedPage.current !== conversation.key) {
      scroll.current
        .querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(conversation.anchor)}"]`,
        )
        ?.scrollIntoView({ block: 'center' });
      wasNearBottom.current = false;
    } else if (wasNearBottom.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
    }
    positionedPage.current = conversation.key;
  }, [conversation.page, roomId, conversationTab, mode]);
  useEffect(() => {
    if (!replyScroll.current || !conversation.threadPage) return;
    const changed = positionedThread.current !== conversation.threadKey;
    if (changed && conversation.replyAnchor) {
      replyScroll.current
        .querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(conversation.replyAnchor)}"]`,
        )
        ?.scrollIntoView({ block: 'center' });
      repliesNearBottom.current = false;
    } else if (changed || repliesNearBottom.current) {
      replyScroll.current.scrollTop = replyScroll.current.scrollHeight;
    }
    positionedThread.current = conversation.threadKey;
  }, [conversation.threadPage]);
  function switchMode(next: Mode) {
    setMode(next);
    setProfileId(null);
    setThreadId(null);
    setAssistantOpen(false);
    setConversationTab('messages');
  }
  function chooseConversationTab(next: 'messages' | 'files') {
    setConversationTab(next);
    setProfileId(null);
    setMode('home');
    setThreadId(null);
    setAssistantOpen(false);
  }
  const navigate = (id: string) => {
    if (id !== roomId) {
      const next = history.slice(0, historyAt + 1);
      next.push(id);
      setHistory(next);
      setHistoryAt(next.length - 1);
    }
    setRoomId(id);
    setProfileId(null);
    conversation.move({});
    setThreadId(null);
    positionedThread.current = null;
    setMode('home');
    setConversationTab('messages');
    wasNearBottom.current = true;
  };
  const changeHistory = (offset: number) => {
    const at = historyAt + offset;
    if (at < 0 || at >= history.length) return;
    setHistoryAt(at);
    setRoomId(history[at]);
    setProfileId(null);
    setConversationTab('messages');
    setThreadId(null);
    positionedThread.current = null;
    setMode('home');
    conversation.move({});
    wasNearBottom.current = true;
  };
  function jumpToMessage(message: Message) {
    navigate(message.roomId);
    conversation.locate(message);
    setThreadId(message.parentId);
    setAssistantOpen(false);
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!root.current?.contains(event.target as Node)) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        ['b', 'i', 'u'].includes(event.key.toLowerCase()) &&
        (event.target as HTMLElement).closest('.ql-editor')
      )
        event.stopPropagation();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setModal('search');
      }
      if (event.key === 'Escape') {
        if (modal || root.current?.querySelector('dialog[open], [popover]:popover-open'))
          return;
        if (profileId) {
          closeProfile();
          return;
        }
        setThreadId(null);
        setReactionId(null);
        setAssistantOpen(false);
      }
    };
    const el = root.current;
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
  }, [modal, profileId]);
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
  function openProfile(id: string) {
    profileOrigin.current = document.activeElement as HTMLElement;
    setProfileId(id);
    setThreadId(null);
    setAssistantOpen(false);
  }
  function closeProfile() {
    setProfileId(null);
    const origin = profileOrigin.current;
    if (origin?.isConnected) origin.focus();
    else
      root.current
        ?.querySelector<HTMLInputElement>('input[type="search"]')
        ?.focus();
  }
  function newChannel() {
    setRoomName('');
    setDescription('');
    setModal('channel');
  }
  async function startDm(member: Member) {
    setBusy(true);
    try {
      const room = await act(() =>
        rpc.call('createRoom', {
          name: member.name,
          description: '',
          recipient: member.id,
        }),
      );
      if (room) {
        navigate(room.id);
        setModal(null);
      }
    } finally {
      setBusy(false);
    }
  }
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
    const author = data?.members.find((a) => a.id === m.author);
    return (
      <article
        className={`slack-message ${m.deleted ? 'slack-deleted' : ''}`}
        key={m.id}
        data-message-id={m.id}
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
            <button
              type="button"
              className="slack-author-button"
              title="View teammate profile"
              aria-label={`View ${author?.name ?? 'teammate'} profile`}
              aria-describedby="slack-key-help"
              disabled={!author}
              onClick={() => author && openProfile(author.id)}
            >
              <strong>{author?.name ?? 'Teammate'}</strong>
            </button>
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
                <Attachment
                  message={m}
                  onDownload={() => void download(m)}
                  onPreview={setPreview}
                />
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
                  count={m.replyCount}
                  name={memberName(m.lastReply?.author ?? m.author)}
                  timestamp={m.lastReply?.createdAt ?? m.createdAt}
                  onClick={() => {
                    setProfileId(null);
                    setAssistantOpen(false);
                    setThreadId(m.id);
                  }}
                />
              )}
              <Toolbar
                own={m.author === data?.me.id}
                saved={m.saved}
                onEdit={() => {
                  setEditing(m);
                }}
                onDelete={() => setDeleting(m)}
                onThread={() => {
                  setProfileId(null);
                  setAssistantOpen(false);
                  setThreadId(m.parentId ?? m.id);
                }}
                onReaction={() => setReactionId(m.id)}
                onSave={() => void act(() => rpc.call('save', { id: m.id }))}
              />
            </>
          )}
        </div>
      </article>
    );
  }
  function renderFiles(scope?: string) {
    return (
      <FilesView
        key={scope ?? 'all'}
        roomId={scope}
        rooms={data?.rooms ?? []}
        members={data?.members ?? []}
        onOpen={jumpToMessage}
        onDownload={(message) => void download(message)}
        onPreview={setPreview}
      />
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
              { id: 'files', label: 'Files', icon: FilesIcon },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.id}
              title={item.label}
              aria-current={
                mode === item.id ||
                (item.id === 'home' &&
                  ['threads', 'saved', 'directories'].includes(mode))
                  ? 'page'
                  : undefined
              }
              aria-describedby="slack-key-help"
              className={`slack-rail-item ${mode === item.id || (item.id === 'home' && ['threads', 'saved', 'directories'].includes(mode)) ? 'is-current' : ''}`}
              onClick={() => switchMode(item.id)}
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
          <MoreNavigation
            onSelect={(destination) => {
              if (destination === 'settings') openSettings();
              else if (destination === 'help') setModal('help');
              else switchMode(destination);
            }}
          />
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
              onClick={() => openProfile(data.me.id)}
            >
              {data.me.name.charAt(0)}
            </button>
          </div>
        </nav>
        <aside
          className="slack-sidebar"
          aria-label="Channels and direct messages"
        >
          {mode === 'files' ? (
            <div className="slack-workspace-header">
              <strong>Files</strong>
            </div>
          ) : (
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
              <IconButton
                label="New conversation"
                onClick={() => setModal('dm')}
              >
                <Pencil size={18} />
              </IconButton>
            </div>
          )}
          {mode === 'files' ? (
            <div className="slack-sidebar-links">
              <button
                type="button"
                className="selected"
                title="Browse all shared files"
                aria-describedby="slack-key-help"
                onClick={() => switchMode('files')}
              >
                <FilesIcon size={16} />
                All files
              </button>
            </div>
          ) : (
            <>
              <div className="slack-sidebar-links">
                <button
                  type="button"
                  title="View channel threads"
                  aria-describedby="slack-key-help"
                  className={mode === 'threads' ? 'selected' : ''}
                  onClick={() => switchMode('threads')}
                >
                  <MessageSquareText size={16} />
                  Threads
                </button>
                <button
                  type="button"
                  title="Browse workspace directory"
                  className={mode === 'directories' ? 'selected' : ''}
                  aria-current={mode === 'directories' ? 'page' : undefined}
                  aria-describedby="slack-key-help"
                  onClick={() => switchMode('directories')}
                >
                  <Users size={16} />
                  Directories
                </button>
                <button
                  type="button"
                  title="Show unread conversations"
                  aria-describedby="slack-key-help"
                  onClick={() => switchMode('activity')}
                >
                  <Bell size={16} />
                  Unreads {unread > 0 && <b>{unread}</b>}
                </button>
                <button
                  type="button"
                  title="View saved messages"
                  aria-current={mode === 'saved' ? 'page' : undefined}
                  className={mode === 'saved' ? 'selected' : ''}
                  aria-describedby="slack-key-help"
                  onClick={() => switchMode('saved')}
                >
                  <Bookmark size={16} />
                  Saved
                </button>
              </div>
              <WorkspaceSection label="Channels" onNew={newChannel}>
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
                  onClick={newChannel}
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
            </>
          )}
        </aside>
        <main className="slack-main">
          {mode === 'files' ? (
            renderFiles()
          ) : mode === 'directories' ? (
            <Directory
              rooms={data.rooms}
              members={data.members}
              onRoom={navigate}
              onProfile={openProfile}
              onCreate={newChannel}
            />
          ) : (mode === 'home' || mode === 'threads') && room ? (
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
                <div className="slack-header-actions">
                  <div className="slack-header-members">
                    <Users size={16} />
                    <span>{room.recipient ? 2 : data.members.length}</span>
                  </div>
                  <IconButton
                    label="Ask about conversation"
                    aria-pressed={assistantOpen}
                    onClick={() => {
                      setProfileId(null);
                      setThreadId(null);
                      setAssistantOpen(!assistantOpen);
                    }}
                  >
                    <Sparkles size={19} />
                  </IconButton>
                </div>
              </header>
              <div className="slack-channel-tabs">
                <button
                  type="button"
                  className={conversationTab === 'messages' ? 'active-tab' : ''}
                  aria-pressed={conversationTab === 'messages'}
                  title="Show conversation messages"
                  aria-describedby="slack-key-help"
                  onClick={() => chooseConversationTab('messages')}
                >
                  Messages
                </button>
                <button
                  type="button"
                  className={conversationTab === 'files' ? 'active-tab' : ''}
                  aria-pressed={conversationTab === 'files'}
                  title="Browse shared files"
                  aria-describedby="slack-key-help"
                  onClick={() => chooseConversationTab('files')}
                >
                  Files
                </button>
                {connection !== 'connected' && (
                  <span role="status">Reconnecting…</span>
                )}
              </div>
              {mode === 'home' &&
                conversationTab === 'files' &&
                renderFiles(roomId)}
              <div
                className="slack-message-view"
                hidden={mode === 'home' && conversationTab === 'files'}
              >
                <div
                  className="slack-message-scroll"
                  ref={scroll}
                  onScroll={() => {
                    if (scroll.current && conversationTab === 'messages')
                      wasNearBottom.current =
                        scroll.current.scrollHeight -
                          scroll.current.scrollTop -
                          scroll.current.clientHeight <
                        90;
                  }}
                >
                  <HistoryNavigation
                    page={conversation.page}
                    name="channel"
                    onMove={(cursor) => {
                      wasNearBottom.current = !cursor.after;
                      if (cursor.after && scroll.current)
                        scroll.current.scrollTop = 0;
                      conversation.move(cursor);
                    }}
                  />
                  {mode === 'threads' ? (
                    <>
                      <h2 className="slack-list-title">
                        Threads in{' '}
                        {room.recipient ? room.name : `#${room.name}`}
                      </h2>
                      {currentMessages
                        .filter((m) => !m.parentId && m.replyCount > 0)
                        .map((m) => messageCard(m))}
                      {!currentMessages.some((m) => m.replyCount > 0) && (
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
                      {conversation.page?.before === null &&
                        (room.recipient ? (
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
                        ))}
                      {currentMessages.map((m, index) => (
                        <Fragment key={m.id}>
                          {(index === 0 ||
                            new Date(m.createdAt).toDateString() !==
                              new Date(
                                currentMessages[index - 1].createdAt,
                              ).toDateString()) && (
                            <div className="slack-date-rule">
                              <span>
                                {new Date(m.createdAt).toLocaleDateString(
                                  undefined,
                                  {
                                    month: 'long',
                                    day: 'numeric',
                                    year:
                                      new Date(m.createdAt).getFullYear() ===
                                      new Date().getFullYear()
                                        ? undefined
                                        : 'numeric',
                                  },
                                )}
                              </span>
                            </div>
                          )}
                          {messageCard(m)}
                        </Fragment>
                      ))}
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
                    onSent={() => {
                      wasNearBottom.current = true;
                      conversation.move({});
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <header className="slack-channel-header">
                <h1>
                  {mode === 'dms'
                    ? 'Direct messages'
                    : mode === 'activity'
                      ? 'Activity'
                      : 'Saved'}
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
                            jumpToMessage(m);
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
        {assistantOpen && !profileId && room && (
          <Assistant
            key={roomId}
            roomId={roomId}
            name={room.recipient ? room.name : `#${room.name}`}
            onClose={() => {
              setAssistantOpen(false);
              root.current
                ?.querySelector<HTMLButtonElement>(
                  '[aria-label="Ask about conversation"]',
                )
                ?.focus();
            }}
          />
        )}
        {!assistantOpen && !profileId && threadId && parent && (
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
            <div
              className="slack-message-scroll"
              ref={replyScroll}
              onScroll={() => {
                const el = replyScroll.current;
                if (el)
                  repliesNearBottom.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 90;
              }}
            >
              {messageCard(parent, true)}
              <div className="slack-reply-rule">
                {parent.replyCount}{' '}
                {parent.replyCount === 1 ? 'reply' : 'replies'}
              </div>
              <HistoryNavigation
                page={conversation.threadPage}
                name="thread"
                onMove={conversation.moveThread}
              />
              {conversation.replies.map((m) => messageCard(m, true))}
            </div>
            <Composer
              key={threadId}
              roomId={roomId}
              parentId={threadId}
              name="thread"
              rpc={rpc}
              refresh={refresh}
              onSent={() => {
                repliesNearBottom.current = true;
                conversation.moveThread({});
              }}
            />
          </aside>
        )}
        {profile && (
          <Profile
            member={profile}
            me={data.me.id}
            busy={busy}
            error={error}
            onClose={closeProfile}
            onMessage={() => void startDm(profile)}
            onEdit={openSettings}
          />
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
                    onClick={() => void startDm(m)}
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
                <dt>Bold / italic / underline</dt>
                <dd>⌘ / Ctrl B / I / U</dd>
                <dt>Move between controls</dt>
                <dd>Tab / Shift Tab</dd>
                <dt>Activate a control</dt>
                <dd>Enter / Space</dd>
                <dt>Close a dialog or thread</dt>
                <dd>Escape</dd>
              </dl>
              <p>
                Hover or focus a message for reactions, replies, saving and your
                own edit/delete actions. Format selected text or what you type
                next; lists, quotes and code blocks format the current line.
                Draft text is saved as you type. Files up to 2 MB can be
                attached.
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
                      jumpToMessage(m);
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
      {preview && (
        <Dialog title={preview.name} onClose={() => setPreview(null)}>
          <div className="slack-dialog-body">
            <img
              className="slack-image-preview"
              src={`data:${preview.mime};base64,${preview.data}`}
              alt={preview.name}
            />
          </div>
        </Dialog>
      )}
      {editing && (
        <Dialog title="Edit message" onClose={() => setEditing(null)}>
          <div className="slack-dialog-body">
            <Editor
              editing
              placeholder="Edit message"
              initial={
                editing.rich ?? {
                  ops: [
                    {
                      insert: editing.text.endsWith('\n')
                        ? editing.text
                        : editing.text + '\n',
                    },
                  ],
                }
              }
              onDraft={() => {}}
              onSubmit={async (value) => {
                await rpc.call('edit', {
                  id: editing.id,
                  text: value.text,
                  rich: value.rich,
                });
                await refresh();
                setEditing(null);
              }}
            />
          </div>
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
            <EmojiMenu
              onSelect={(emoji) =>
                void act(() =>
                  rpc.call('react', { id: reactionId, emoji }),
                ).then((result) => {
                  if (result) setReactionId(null);
                })
              }
            />
          </div>
        </Dialog>
      )}
      <span id="slack-key-help" className="slack-sr">
        Use Tab to focus controls, then Enter or Space to activate. Escape
        closes menus, profiles, dialogs and the thread pane. Actions save in
        this VV workspace.
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
