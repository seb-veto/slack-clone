import { useRef, useState } from 'react';
import {
  Ellipsis,
  Users,
  Files,
  Bookmark,
  Settings,
  HelpCircle,
} from 'lucide-react';

export type MoreDestination =
  | 'directories'
  | 'files'
  | 'saved'
  | 'settings'
  | 'help';
const entries = [
  { id: 'directories', label: 'Directories', icon: Users },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'settings', label: 'Workspace settings', icon: Settings },
  { id: 'help', label: 'Keyboard shortcuts', icon: HelpCircle },
] as const;

export function MoreNavigation({
  onSelect,
}: {
  onSelect: (value: MoreDestination) => void;
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
        className={`slack-rail-item ${open ? 'is-current' : ''}`}
        title="More navigation"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="slack-more-menu"
        aria-describedby="slack-key-help"
        popoverTarget="slack-more-menu"
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
          event.preventDefault();
          fromEnd.current = event.key === 'ArrowUp';
          menu.current?.showPopover();
        }}
      >
        <span>
          <Ellipsis size={22} />
        </span>
        More
      </button>
      <nav
        ref={menu}
        id="slack-more-menu"
        className="slack-more-menu"
        popover="auto"
        role="menu"
        aria-label="More navigation"
        onBeforeToggle={(event) => {
          if (event.newState !== 'open' || !trigger.current || !menu.current)
            return;
          const rect = trigger.current.getBoundingClientRect();
          menu.current.style.left = `${Math.max(8, Math.min(rect.right + 8, window.innerWidth - 288))}px`;
          menu.current.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - 300))}px`;
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
        <h2>More</h2>
        {entries.map((entry) => (
          <button
            type="button"
            role="menuitem"
            key={entry.id}
            title={`Open ${entry.label}`}
            aria-describedby="slack-key-help"
            onClick={() => {
              menu.current?.hidePopover();
              trigger.current?.focus();
              onSelect(entry.id);
            }}
          >
            <entry.icon size={19} />
            {entry.label}
          </button>
        ))}
      </nav>
    </>
  );
}
