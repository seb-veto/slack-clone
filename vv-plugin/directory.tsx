import { useEffect, useRef, useState } from 'react';
import { Bot, Hash, Search, Users, MessageSquare, X } from 'lucide-react';
import type { Member, Room } from './contract.ts';
import { directoryEntries } from './directory-data.ts';
import { IconButton } from './components.tsx';

export function Directory({
  rooms,
  members,
  onRoom,
  onProfile,
  onCreate,
}: {
  rooms: Room[];
  members: Member[];
  onRoom: (id: string) => void;
  onProfile: (id: string) => void;
  onCreate: () => void;
}) {
  const [tab, setTab] = useState<'channels' | 'people'>('people');
  const [query, setQuery] = useState('');
  const entries = directoryEntries(rooms, members, query);
  return (
    <section className="slack-directory" aria-label="Directories">
      <header className="slack-channel-header">
        <h1>Directories</h1>
        {tab === 'channels' && (
          <button
            type="button"
            className="slack-primary"
            title="Create a channel"
            aria-describedby="slack-key-help"
            onClick={onCreate}
          >
            Create channel
          </button>
        )}
      </header>
      <div className="slack-channel-tabs" aria-label="Directory views">
        <button
          type="button"
          className={tab === 'channels' ? 'active-tab' : ''}
          aria-pressed={tab === 'channels'}
          title="Browse public channels"
          aria-describedby="slack-key-help"
          onClick={() => {
            setTab('channels');
            setQuery('');
          }}
        >
          Channels
        </button>
        <button
          type="button"
          className={tab === 'people' ? 'active-tab' : ''}
          aria-pressed={tab === 'people'}
          title="Browse workspace teammates"
          aria-describedby="slack-key-help"
          onClick={() => {
            setTab('people');
            setQuery('');
          }}
        >
          People
        </button>
      </div>
      <label className="slack-directory-search">
        <Search size={18} />
        <span className="slack-sr">
          {tab === 'channels' ? 'Find a channel' : 'Find a teammate'}
        </span>
        <input
          autoFocus
          type="search"
          maxLength={200}
          value={query}
          placeholder={tab === 'channels' ? 'Search channels' : 'Search people'}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="slack-directory-list">
        {tab === 'channels'
          ? entries.channels.map((room) => (
              <button
                type="button"
                className="slack-directory-row"
                key={room.id}
                data-room-id={room.id}
                title="Open channel"
                aria-describedby="slack-key-help"
                onClick={() => onRoom(room.id)}
              >
                <Hash size={25} />
                <span>
                  <strong>{room.name}</strong>
                  <small>{room.description || 'Public channel'}</small>
                </span>
                <span className="slack-directory-action" aria-hidden="true">
                  Open
                </span>
              </button>
            ))
          : entries.people.map((member) => (
              <button
                type="button"
                className="slack-directory-row"
                data-member-id={member.id}
                key={member.id}
                title="View teammate profile"
                aria-describedby="slack-key-help"
                onClick={() => onProfile(member.id)}
              >
                <span
                  className={`slack-avatar ${member.kind === 'agent' ? 'slack-avatar-agent' : ''}`}
                  aria-hidden="true"
                >
                  {member.kind === 'agent' ? (
                    <Bot size={24} />
                  ) : (
                    member.name.charAt(0).toUpperCase()
                  )}
                </span>
                <span>
                  <strong>{member.name}</strong>
                  <small>
                    {member.kind === 'agent'
                      ? 'Agent teammate'
                      : 'Workspace member'}
                  </small>
                </span>
              </button>
            ))}
        {!(tab === 'channels'
          ? entries.channels.length
          : entries.people.length) && (
          <div className="slack-empty">
            <Users size={40} />
            <h2>
              {tab === 'channels' ? 'No channels found' : 'No people found'}
            </h2>
            <p>Try another name.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function Profile({
  member,
  me,
  busy,
  error,
  onClose,
  onMessage,
  onEdit,
}: {
  member: Member;
  me: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onMessage: () => void;
  onEdit: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [member.id]);
  return (
    <aside className="slack-thread slack-profile-pane" aria-label="Profile">
      <header className="slack-channel-header">
        <h2 ref={heading} tabIndex={-1}>
          Profile
        </h2>
        <IconButton label="Close profile" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </header>
      <div className="slack-profile-body">
        <div
          className={`slack-profile-portrait ${member.kind === 'agent' ? 'slack-avatar-agent' : ''}`}
          aria-hidden="true"
        >
          {member.kind === 'agent' ? (
            <Bot size={72} />
          ) : (
            member.name.charAt(0).toUpperCase()
          )}
        </div>
        <h3>
          {member.name}
          {member.kind === 'agent' && (
            <span className="slack-app-badge">APP</span>
          )}
        </h3>
        <p className="slack-muted">
          {member.kind === 'agent' ? 'Agent teammate' : 'Workspace member'}
        </p>
        {member.id === me ? (
          <button
            type="button"
            className="slack-profile-message"
            title="Edit your profile"
            aria-describedby="slack-key-help"
            onClick={onEdit}
          >
            Edit profile
          </button>
        ) : (
          <button
            type="button"
            className="slack-profile-message"
            title="Start direct message"
            aria-label={`Message ${member.name}`}
            aria-describedby="slack-key-help"
            disabled={busy}
            onClick={onMessage}
          >
            <MessageSquare size={18} />
            Message
          </button>
        )}
        {member.kind === 'agent' && (
          <p className="slack-profile-explanation">
            Messages stay in VV. Sending a DM does not automatically start this
            agent.
          </p>
        )}
        {error && (
          <p className="slack-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
