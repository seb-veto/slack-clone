// Adapted from sanidhyy/slack-clone (MIT): WorkspaceSection, ChannelHero, Reactions,
// Toolbar, ThreadBar and Editor. Convex/Next identities are supplied by VV.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Quill from 'quill';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Smile,
  MessageSquareText,
  Pencil,
  Trash2,
  Bookmark,
  Send,
  Paperclip,
  X,
} from 'lucide-react';
import type { z } from 'zod';
import type { delta, file, Message } from './contract.ts';
import 'quill/dist/quill.snow.css';

export function IconButton({
  label,
  children,
  ...props
}: {
  label: string;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-describedby="slack-key-help"
      {...props}
    >
      {children}
    </button>
  );
}
export function WorkspaceSection({
  label,
  onNew,
  children,
}: {
  label: string;
  onNew?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="slack-section">
      <div className="slack-section-heading">
        <button
          type="button"
          title={`Toggle ${label}`}
          aria-expanded={open}
          aria-describedby="slack-key-help"
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{' '}
          {label}
        </button>
        {onNew && (
          <IconButton
            label={`Add ${label === 'Channels' ? 'channel' : 'teammate'}`}
            onClick={onNew}
          >
            <Plus size={16} />
          </IconButton>
        )}
      </div>
      {open && children}
    </section>
  );
}
export function ChannelHero({
  name,
  description,
  createdAt,
}: {
  name: string;
  description: string;
  createdAt: number;
}) {
  return (
    <div className="slack-hero">
      <div className="slack-hero-mark">#</div>
      <h1>{name}</h1>
      <p>
        This is the very beginning of the <strong>#{name}</strong> channel.
      </p>
      <p>
        {description ||
          `Created on ${new Date(createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}.`}
      </p>
    </div>
  );
}
export function Reactions({
  message,
  me,
  onChange,
}: {
  message: Message;
  me: string;
  onChange: (emoji: string) => void;
}) {
  return message.reactions.length ? (
    <div className="slack-reactions">
      {message.reactions.map((r) => (
        <button
          type="button"
          key={r.emoji}
          title={`React ${r.emoji}`}
          aria-label={`${r.emoji}, ${r.members.length} reactions`}
          aria-pressed={r.members.includes(me)}
          aria-describedby="slack-key-help"
          onClick={() => onChange(r.emoji)}
        >
          {r.emoji} <span>{r.members.length}</span>
        </button>
      ))}
    </div>
  ) : null;
}
export function Toolbar({
  own,
  saved,
  onEdit,
  onDelete,
  onThread,
  onReaction,
  onSave,
}: {
  own: boolean;
  saved: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onThread: () => void;
  onReaction: () => void;
  onSave: () => void;
}) {
  return (
    <div className="slack-message-toolbar">
      <IconButton label="Add reaction" onClick={onReaction}>
        <Smile size={17} />
      </IconButton>
      <IconButton label="Reply in thread" onClick={onThread}>
        <MessageSquareText size={17} />
      </IconButton>
      <IconButton
        label={saved ? 'Remove from Saved' : 'Save for later'}
        onClick={onSave}
      >
        <Bookmark size={17} fill={saved ? 'currentColor' : 'none'} />
      </IconButton>
      {own && (
        <>
          <IconButton label="Edit message" onClick={onEdit}>
            <Pencil size={17} />
          </IconButton>
          <IconButton label="Delete message" onClick={onDelete}>
            <Trash2 size={17} />
          </IconButton>
        </>
      )}
    </div>
  );
}
export function ThreadBar({
  count,
  name,
  timestamp,
  onClick,
}: {
  count: number;
  name: string;
  timestamp: number;
  onClick: () => void;
}) {
  return count ? (
    <button
      type="button"
      title="View thread"
      aria-describedby="slack-key-help"
      className="slack-thread-bar"
      onClick={onClick}
    >
      <span className="slack-tiny-avatar">{name.charAt(0)}</span>
      <strong>
        {count} {count === 1 ? 'reply' : 'replies'}
      </strong>
      <span>
        Last reply{' '}
        {new Date(timestamp).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        })}
      </span>
      <ChevronRight size={14} />
    </button>
  ) : null;
}
export function RichText({ message }: { message: Message }) {
  if (!message.rich)
    return <div className="slack-message-text">{message.text}</div>;
  return (
    <div className="slack-message-text">
      {message.rich.ops.map((op, i) => {
        let content: ReactNode = op.insert;
        const a = op.attributes;
        if (a?.bold) content = <strong>{content}</strong>;
        if (a?.italic) content = <em>{content}</em>;
        if (a?.strike) content = <s>{content}</s>;
        if (a?.code) content = <code>{content}</code>;
        if (a?.link && /^https?:\/\//.test(a.link))
          content = (
            <a href={a.link} target="_blank" rel="noreferrer">
              {content}
            </a>
          );
        return <span key={i}>{content}</span>;
      })}
    </div>
  );
}
type Delta = z.infer<typeof delta>;
type FileData = z.infer<typeof file>;
export function EmojiMenu({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <EmojiPicker
      emojiStyle={EmojiStyle.NATIVE}
      theme={Theme.LIGHT}
      lazyLoadEmojis
      width="100%"
      height={360}
      onEmojiClick={(data) => onSelect(data.emoji)}
    />
  );
}
export function Editor({
  placeholder,
  initial,
  onDraft,
  onSubmit,
  editing = false,
}: {
  placeholder: string;
  initial: Delta | null;
  editing?: boolean;
  onDraft: (v: Delta | null) => void;
  onSubmit: (v: {
    text: string;
    rich: Delta;
    attachment: FileData | null;
    id: string;
  }) => Promise<void>;
}) {
  const mount = useRef<HTMLDivElement>(null),
    quill = useRef<Quill | null>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const submission = useRef(crypto.randomUUID());
  const callbacks = useRef({ onDraft, onSubmit });
  callbacks.current = { onDraft, onSubmit };
  const [text, setText] = useState(''),
    [attachment, setAttachment] = useState<FileData | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false),
    [formatting, setFormatting] = useState(true);
  const state = useRef({ attachment, pending });
  state.current = { attachment, pending };
  const send = useRef<() => void>(() => {});
  send.current = () => {
    const q = quill.current;
    if (
      !q ||
      state.current.pending ||
      (!q.getText().trim() && !state.current.attachment)
    )
      return;
    setPending(true);
    state.current.pending = true;
    q.enable(false);
    setError('');
    void callbacks.current
      .onSubmit({
        id: submission.current,
        text: q.getText(),
        rich: { ops: q.getContents().ops } as Delta,
        attachment: state.current.attachment,
      })
      .then(() => {
        if (!mount.current) return;
        q.setText('', 'silent');
        setText('');
        setAttachment(null);
        if (fileInput.current) fileInput.current.value = '';
        submission.current = crypto.randomUUID();
        callbacks.current.onDraft(null);
      })
      .catch((e) =>
        setError(
          e instanceof Error
            ? e.message
            : 'Could not send. Your draft is still here.',
        ),
      )
      .finally(() => {
        setPending(false);
        state.current.pending = false;
        q.enable();
        if (mount.current) q.focus();
      });
  };
  useEffect(() => {
    if (!mount.current) return;
    const host = mount.current.appendChild(document.createElement('div'));
    const q = new Quill(host, {
      theme: 'snow',
      placeholder,
      formats: ['bold', 'italic', 'strike', 'code', 'link'],
      modules: {
        toolbar: [
          ['bold', 'italic', 'strike'],
          ['code', 'link'],
        ],
        keyboard: {
          bindings: {
            enter: {
              key: 'Enter',
              shiftKey: false,
              handler: () => {
                send.current();
                return false;
              },
            },
          },
        },
      },
    });
    quill.current = q;
    if (initial)
      q.setContents(initial as Parameters<Quill['setContents']>[0], 'silent');
    setText(q.getText());
    q.root.setAttribute('aria-label', placeholder);
    q.root.setAttribute('role', 'textbox');
    q.root.setAttribute('aria-multiline', 'true');
    q.root.setAttribute('aria-describedby', 'slack-composer-help');
    const names: Record<string, string> = {
      'ql-bold': 'Bold',
      'ql-italic': 'Italic',
      'ql-strike': 'Strikethrough',
      'ql-code': 'Inline code',
      'ql-link': 'Insert link',
    };
    mount.current.querySelectorAll('button').forEach((b) => {
      const label = names[b.className] ?? 'Format text';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.setAttribute('aria-describedby', 'slack-key-help');
    });
    const change = () => {
      setText(q.getText());
      submission.current = crypto.randomUUID();
      callbacks.current.onDraft({ ops: q.getContents().ops } as Delta);
    };
    q.on('text-change', change);
    return () => {
      q.off('text-change', change);
      quill.current = null;
      mount.current?.replaceChildren();
    };
  }, []);
  async function attach(selected?: File) {
    if (!selected) return;
    if (
      selected.size > 2 * 1024 * 1024 ||
      ![
        'image/png',
        'image/jpeg',
        'image/webp',
        'text/plain',
        'application/pdf',
      ].includes(selected.type)
    ) {
      setError('Choose a PNG, JPEG, WebP, text or PDF file up to 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('Could not read that file.');
    reader.onload = () => {
      setAttachment({
        name: selected.name,
        mime: selected.type as FileData['mime'],
        data: String(reader.result).split(',')[1],
      });
      submission.current = crypto.randomUUID();
      setError('');
    };
    reader.readAsDataURL(selected);
  }
  return (
    <div
      className="slack-composer-wrap"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setEmojiOpen(false);
      }}
    >
      <div
        className={`slack-composer ${formatting ? '' : 'slack-format-hidden'}`}
      >
        <div ref={mount} />
        {attachment && (
          <div className="slack-attached">
            <Paperclip size={14} />
            {attachment.name}
            <IconButton
              label="Remove attachment"
              disabled={pending}
              onClick={() => {
                setAttachment(null);
                submission.current = crypto.randomUUID();
              }}
            >
              <X size={14} />
            </IconButton>
          </div>
        )}
        <div className="slack-composer-actions">
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,text/plain,application/pdf"
            aria-label="Attach file"
            hidden
            onChange={(e) => void attach(e.target.files?.[0])}
          />
          {!editing && (
            <IconButton
              label="Attach file"
              disabled={pending}
              onClick={() => fileInput.current?.click()}
            >
              <Plus size={19} />
            </IconButton>
          )}
          <IconButton
            label="Insert emoji"
            aria-expanded={emojiOpen}
            disabled={pending}
            onClick={() => setEmojiOpen(!emojiOpen)}
          >
            <Smile size={19} />
          </IconButton>
          <span className="slack-composer-divider" />
          <IconButton
            label={formatting ? 'Hide formatting' : 'Show formatting'}
            aria-pressed={formatting}
            onClick={() => setFormatting(!formatting)}
          >
            <span className="slack-composer-note">Aa</span>
          </IconButton>
          <IconButton
            label={editing ? 'Save changes' : 'Send message'}
            className="slack-send"
            disabled={pending || (!text.trim() && !attachment)}
            onClick={() => send.current()}
          >
            <Send size={17} />
          </IconButton>
        </div>
        {emojiOpen && (
          <div className="slack-composer-emoji" role="group" aria-label="Emoji">
            <IconButton
              label="Close emoji picker"
              onClick={() => setEmojiOpen(false)}
            >
              <X size={14} />
            </IconButton>
            <EmojiMenu
              onSelect={(emoji) => {
                const q = quill.current;
                if (q) {
                  const at = q.getSelection(true)?.index ?? q.getLength() - 1;
                  q.insertText(at, emoji, 'user');
                  q.setSelection(at + emoji.length);
                  q.focus();
                }
                setEmojiOpen(false);
              }}
            />
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="slack-error">
          {error}
        </p>
      )}
      <div className="slack-composer-hint" id="slack-composer-help">
        <strong>Enter</strong> {editing ? 'to save' : 'to send'} ·{' '}
        <strong>Shift + Enter</strong> for a new line
      </div>
    </div>
  );
}
