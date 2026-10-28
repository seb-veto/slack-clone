import { useRef, useState, type ReactNode } from 'react';
import type { Room } from './contract.ts';
import { recentConversations } from './navigation-data.ts';
import {
  Ellipsis,
  Users,
  Files,
  Bookmark,
  Settings,
  HelpCircle,
  Clock,
  Hash,
  MessageSquare,
  Check,
} from 'lucide-react';

export type MoreDestination =
  'directories' | 'files' | 'saved' | 'settings' | 'help';
const entries = [
  { id: 'directories', label: 'Directories', icon: Users },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'settings', label: 'Workspace settings', icon: Settings },
  { id: 'help', label: 'Keyboard shortcuts', icon: HelpCircle },
] as const;

type MenuEntry = {
  id: string;
  label: string;
  icon: typeof Users;
  current?: boolean;
  select: () => void;
};
function NavigationMenu({
  id,
  label,
  title,
  children,
  items,
  below = false,
}: {
  id: string;
  label: string;
  title: string;
  children: ReactNode;
  items: MenuEntry[];
  below?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const fromEnd = useRef(false);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`${below ? 'slack-history-trigger' : 'slack-rail-item'} ${open ? 'is-current' : ''}`}
        title={title}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-describedby="slack-key-help"
        popoverTarget={id}
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
          event.preventDefault();
          fromEnd.current = event.key === 'ArrowUp';
          menu.current?.showPopover();
        }}
      >
        {children}
      </button>
      <nav
        ref={menu}
        id={id}
        className={`slack-more-menu ${below ? 'slack-history-menu' : ''}`}
        popover="auto"
        role="menu"
        aria-label={title}
        onBeforeToggle={(event) => {
          if (event.newState !== 'open' || !trigger.current || !menu.current)
            return;
          const rect = trigger.current.getBoundingClientRect();
          const left = below ? rect.left : rect.right + 8;
          const top = below ? rect.bottom + 8 : rect.top;
          menu.current.style.left = `${Math.max(8, Math.min(left, window.innerWidth - 288))}px`;
          menu.current.style.top = `${Math.max(8, Math.min(top, window.innerHeight - 300))}px`;
        }}
        onToggle={() => {
          const shown = menu.current?.matches(':popover-open') ?? false;
          setOpen(shown);
          if (shown) {
            const buttons =
              menu.current!.querySelectorAll<HTMLButtonElement>('button');
            buttons[fromEnd.current ? buttons.length - 1 : 0]?.focus();
            fromEnd.current = false;
          }
        }}
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
            return;
          event.preventDefault();
          const buttons = Array.from(
            menu.current!.querySelectorAll<HTMLButtonElement>('button'),
          );
          const at = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (at + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        }}
      >
        <h2>{label}</h2>
        {items.map((entry) => (
          <button
            type="button"
            role="menuitem"
            key={entry.id}
            title={
              entry.label.split(' ').length <= 4
                ? `Open ${entry.label}`
                : 'Open conversation'
            }
            aria-current={entry.current ? 'page' : undefined}
            aria-describedby="slack-key-help"
            onClick={() => {
              menu.current?.hidePopover();
              trigger.current?.focus();
              entry.select();
            }}
          >
            <entry.icon size={19} />
            <span>{entry.label}</span>
            {entry.current && <Check size={16} aria-hidden="true" />}
          </button>
        ))}
      </nav>
    </>
  );
}

export function MoreNavigation({
  onSelect,
}: {
  onSelect: (value: MoreDestination) => void;
}) {
  return (
    <NavigationMenu
      id="slack-more-menu"
      label="More"
      title="More navigation"
      items={entries.map((entry) => ({
        ...entry,
        select: () => onSelect(entry.id),
      }))}
    >
      <span>
        <Ellipsis size={22} />
      </span>
      More
    </NavigationMenu>
  );
}
export function RecentHistory({
  history,
  at,
  rooms,
  onSelect,
}: {
  history: string[];
  at: number;
  rooms: Room[];
  onSelect: (index: number) => void;
}) {
  return (
    <NavigationMenu
      id="slack-recent-history"
      label="History"
      title="Recent conversations"
      below
      items={recentConversations(history, at, rooms).map(
        ({ room, index, current }) => ({
          id: room.id,
          label: `${room.recipient ? '' : '#'}${room.name}`,
          icon: room.recipient ? MessageSquare : Hash,
          current,
          select: () => onSelect(index),
        }),
      )}
    >
      <Clock size={19} />
    </NavigationMenu>
  );
}
