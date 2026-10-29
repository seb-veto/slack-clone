import { Dialog } from './dialog.tsx';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from '@get-bb/plugin-sdk/app';
import {
  Check,
  Circle,
  Clock,
  ListTodo,
  Plus,
  X,
  Bookmark,
  Pencil,
} from 'lucide-react';
import { rpcContract, type Todo, type Message } from './contract.ts';
import { IconButton, RichText } from './components.tsx';
import type { z } from 'zod';
import type {
  todoList,
  todoUpdate,
  todoBulkPreview,
  todoBulkPrepare,
} from './todo-contract.ts';
type Query = z.input<typeof todoList>;
type BulkAction = z.infer<typeof todoBulkPrepare>['action'];
const bulkLabels = {
  complete: 'Mark complete',
  saved: 'Move to Saved',
  clear: 'Clear to-dos',
};
const localTime = (timestamp: number) => {
  const d = new Date(timestamp);
  return new Date(timestamp - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function TodoForm({
  item,
  onSaved,
  onPending,
}: {
  item?: Todo;
  onSaved: () => void;
  onPending?: (pending: boolean) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const request = useRef(crypto.randomUUID());
  const [text, setText] = useState(item?.text ?? ''),
    [when, setWhen] = useState(
      item?.dueAt == null ? '' : localTime(item.dueAt),
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="slack-dialog-body"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        setPending(true);
        onPending?.(true);
        setError('');
        const dueAt = when ? new Date(when).getTime() : null;
        void (
          item
            ? rpc.call('todoUpdate', {
                id: item.id,
                ...(item.messageId ? {} : { text }),
                dueAt,
              })
            : rpc.call('todoCreate', { id: request.current, text, dueAt })
        )
          .then(onSaved)
          .catch((e) => setError(String(e)))
          .finally(() => {
            setPending(false);
            onPending?.(false);
          });
      }}
    >
      {item?.messageId ? (
        <div className="slack-todo-preview">
          {item.message?.deleted
            ? 'This message was deleted.'
            : item.message?.text || item.message?.attachment?.name}
        </div>
      ) : (
        <label>
          Details
          <textarea
            disabled={pending}
            autoFocus
            required
            maxLength={30000}
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      )}
      <label>
        Reminder
        <input
          type="datetime-local"
          disabled={pending}
          aria-describedby="slack-todo-reminder-help"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </label>
      <p id="slack-todo-reminder-help">
        Your local time. Due reminders appear in Activity and the To-dos badge
        while VV is open.
      </p>
      <div className="slack-todo-presets">
        <button
          type="button"
          disabled={pending}
          title="Remind in 20 minutes"
          aria-describedby="slack-key-help"
          onClick={() => setWhen(localTime(Date.now() + 20 * 60000))}
        >
          In 20 minutes
        </button>
        <button
          type="button"
          disabled={pending}
          title="Remind tomorrow morning"
          aria-describedby="slack-key-help"
          onClick={() => {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            d.setHours(9, 0, 0, 0);
            setWhen(localTime(d.getTime()));
          }}
        >
          Tomorrow at 9:00 AM
        </button>
        <button
          type="button"
          disabled={pending}
          title="Clear due date"
          aria-describedby="slack-key-help"
          onClick={() => setWhen('')}
        >
          Clear due date
        </button>
      </div>
      {error && (
        <p role="alert" className="slack-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="slack-primary"
        title={item ? 'Save to-do' : 'Add to-do'}
        aria-describedby="slack-key-help"
        disabled={pending}
      >
        {pending ? 'Saving…' : item ? 'Save' : 'Add'}
      </button>
    </form>
  );
}
export function ToDos({
  destination = 'todos',
  activity = false,
  onEdit,
  onOpen,
  onCount,
}: {
  destination?: 'todos' | 'saved';
  activity?: boolean;
  onEdit: (item?: Todo) => void;
  onOpen: (message: Message) => void;
  onCount?: (count: number) => void;
}) {
  const region = useRef<HTMLElement>(null),
    restoreFocus = useRef(false);
  const rpc = useRpc<typeof rpcContract>(),
    connection = useRealtimeConnectionState();
  const [status, setStatus] = useState<Query['status']>('all'),
    [reminder, setReminder] = useState<Query['reminder']>('all'),
    [sort, setSort] = useState<Query['sort']>('due'),
    [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{
      items: Todo[];
      total: number;
      nextOffset: number | null;
    }>(),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const [bulkAction, setBulkAction] = useState<BulkAction>('complete');
  const [bulk, setBulk] = useState<z.infer<typeof todoBulkPreview> | null>(
    null,
  );
  const [loadedKey, setLoadedKey] = useState('');
  const version = useRef(0),
    key = JSON.stringify({
      destination,
      status: activity ? 'in_progress' : status,
      reminder: activity ? 'overdue' : reminder,
      sort,
      offset,
    });
  const refresh = useCallback(async () => {
    const n = ++version.current;
    try {
      const next = await rpc.call('todoList', JSON.parse(key));
      if (n === version.current) {
        setPage(next);
        setLoadedKey(key);
        onCount?.(next.total);
        setError('');
      }
    } catch (e) {
      if (n === version.current) setError(String(e));
    }
  }, [rpc, key, onCount]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15000);
    return () => {
      clearInterval(t);
      version.current++;
    };
  }, [refresh, connection]);
  useRealtime('changed', () => void refresh());
  useLayoutEffect(() => {
    if (restoreFocus.current) {
      if (document.activeElement === document.body) {
        const target = region.current?.querySelector<HTMLElement>(
          'button:not(:disabled), select',
        );
        (target ?? region.current)?.focus();
      }
      if (!pending) restoreFocus.current = false;
    }
  }, [page, pending]);
  const update = async (value: z.input<typeof todoUpdate>) => {
    if (pending) return;
    restoreFocus.current =
      region.current?.contains(document.activeElement) ?? false;
    setPending(true);
    try {
      await rpc.call('todoUpdate', value);
      setOffset(0);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };
  const prepareBulk = async () => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      setBulk(
        await rpc.call('todoBulkPrepare', {
          action: bulkAction,
          status,
          reminder,
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };
  const applyBulk = async () => {
    if (pending || !bulk) return;
    setPending(true);
    try {
      await rpc.call('todoBulkApply', { id: bulk.id });
      setBulk(null);
      setOffset(0);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };
  const visible = loadedKey === key ? page : undefined;
  return (
    <section
      ref={region}
      tabIndex={-1}
      className={`slack-todos ${activity || destination === 'saved' ? 'slack-todos-embedded' : ''}`}
      aria-label={
        activity
          ? 'Due reminders'
          : destination === 'saved'
            ? 'Saved to-dos'
            : 'To-dos'
      }
    >
      {!activity && destination === 'todos' && (
        <header className="slack-channel-header">
          <h1>To-dos</h1>
          <button
            type="button"
            title="Add to-do"
            aria-describedby="slack-key-help"
            className="slack-primary"
            onClick={() => onEdit()}
          >
            <Plus size={16} /> Add To-do
          </button>
        </header>
      )}
      {activity && <h2>Due reminders</h2>}
      {!activity && destination === 'todos' && (
        <div className="slack-todo-filters">
          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as Query['status']);
                setOffset(0);
              }}
            >
              <option value="all">In progress and completed</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <label>
            Reminders
            <select
              value={reminder}
              onChange={(e) => {
                setReminder(e.target.value as Query['reminder']);
                setOffset(0);
              }}
            >
              <option value="all">All reminders</option>
              <option value="overdue">Overdue</option>
              <option value="upcoming">Upcoming</option>
              <option value="none">No reminder scheduled</option>
            </select>
          </label>
          <label>
            Sort by
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as Query['sort']);
                setOffset(0);
              }}
            >
              <option value="due">Due date</option>
              <option value="oldest">Earliest date created</option>
              <option value="newest">Latest date created</option>
            </select>
          </label>
        </div>
      )}
      {!activity && destination === 'todos' && (
        <div className="slack-todo-filters">
          <label>
            Bulk action
            <select
              aria-describedby="slack-bulk-help"
              value={bulkAction}
              disabled={pending}
              onChange={(e) => setBulkAction(e.target.value as BulkAction)}
            >
              <option value="complete">Mark complete</option>
              <option value="saved">Move to Saved</option>
              <option value="clear">Clear to-dos</option>
            </select>
          </label>
          <button
            type="button"
            title="Review bulk action"
            aria-describedby="slack-bulk-help slack-key-help"
            disabled={pending || !visible?.total}
            onClick={() => void prepareBulk()}
          >
            Review
          </button>
          <p id="slack-bulk-help">
            Review all to-dos matching these filters, across every page, before
            applying.
          </p>
        </div>
      )}
      {bulk && (
        <Dialog
          title="Review to-do cleanup"
          busy={pending}
          onClose={() => setBulk(null)}
        >
          <div className="slack-dialog-body">
            <p>
              {bulkLabels[bulk.action]}: {bulk.count} to-do
              {bulk.count === 1 ? '' : 's'}.
            </p>
            <p>
              Only the reviewed items will change. New items stay untouched. If
              a reviewed item changes, review again.
            </p>
            {bulk.action === 'clear' && (
              <p>
                Cleared items leave To-dos and Saved. Original messages and
                files remain.
              </p>
            )}
            {error && (
              <p role="alert" className="slack-error">
                {error}
              </p>
            )}
            <button
              type="button"
              className="slack-primary"
              title="Apply reviewed action"
              aria-describedby="slack-key-help"
              disabled={pending || !bulk.count}
              onClick={() => void applyBulk()}
            >
              {pending ? 'Applying…' : 'Apply'}
            </button>
            <button
              type="button"
              title="Cancel bulk action"
              aria-describedby="slack-key-help"
              disabled={pending}
              onClick={() => setBulk(null)}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
      {error && (
        <p role="alert" className="slack-error">
          {error}
        </p>
      )}
      {!visible && !error && <p role="status">Loading to-dos…</p>}
      {visible?.items.length === 0 && destination === 'todos' && !activity && (
        <div className="slack-empty">
          <ListTodo size={40} />
          <h2>A little less to remember</h2>
          <p>Add a to-do or keep track of a message or file here.</p>
        </div>
      )}
      <div className="slack-todo-list">
        {visible?.items.map((item) => (
          <article
            className={`slack-todo-card ${item.completedAt !== null ? 'is-complete' : ''}`}
            key={item.id}
            data-todo-id={item.id}
          >
            {destination === 'todos' && (
              <IconButton
                label={
                  item.completedAt === null
                    ? 'Mark complete'
                    : 'Mark in progress'
                }
                disabled={pending}
                aria-pressed={item.completedAt !== null}
                onClick={() =>
                  void update({
                    id: item.id,
                    completed: item.completedAt === null,
                  })
                }
              >
                {item.completedAt === null ? (
                  <Circle size={20} />
                ) : (
                  <Check size={20} />
                )}
              </IconButton>
            )}
            <div className="slack-todo-content">
              {item.message ? (
                <>
                  <button
                    type="button"
                    className="slack-todo-original"
                    title="Open original message"
                    aria-describedby="slack-key-help"
                    onClick={() => onOpen(item.message!)}
                  >
                    Open conversation
                  </button>
                  {item.message.deleted ? (
                    <p>This message was deleted.</p>
                  ) : (
                    <RichText message={item.message} />
                  )}{' '}
                  {item.message.attachment && (
                    <p>{item.message.attachment.name}</p>
                  )}
                </>
              ) : (
                <p className="slack-message-text">{item.text}</p>
              )}
              {item.dueAt !== null && (
                <span
                  className={`slack-todo-date ${item.dueAt <= Date.now() && item.completedAt === null ? 'is-overdue' : ''}`}
                >
                  <Clock size={13} />
                  {new Date(item.dueAt).toLocaleString()}
                </span>
              )}
            </div>
            <div className="slack-todo-actions">
              <IconButton
                label={item.messageId ? 'Edit reminder' : 'Edit to-do'}
                disabled={pending}
                onClick={() => onEdit(item)}
              >
                <Pencil size={17} />
              </IconButton>
              <IconButton
                label={
                  destination === 'saved' ? 'Move to to-dos' : 'Move to saved'
                }
                disabled={pending}
                onClick={() =>
                  void update({
                    id: item.id,
                    destination: destination === 'saved' ? 'todos' : 'saved',
                  })
                }
              >
                {destination === 'saved' ? (
                  <ListTodo size={17} />
                ) : (
                  <Bookmark size={17} />
                )}
              </IconButton>
              <IconButton
                label="Clear to-do"
                disabled={pending}
                onClick={() =>
                  void update({ id: item.id, destination: 'cleared' })
                }
              >
                <X size={17} />
              </IconButton>
            </div>
          </article>
        ))}
      </div>
      {visible && (offset > 0 || visible.nextOffset !== null) && (
        <nav className="slack-todo-pages" aria-label="To-do pages">
          <button
            type="button"
            title="Previous to-do page"
            aria-describedby="slack-key-help"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            Previous
          </button>
          <span>
            {offset + 1}–{offset + visible.items.length} of {visible.total}
          </span>
          <button
            type="button"
            title="Next to-do page"
            aria-describedby="slack-key-help"
            disabled={visible.nextOffset === null}
            onClick={() => setOffset(visible.nextOffset!)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
