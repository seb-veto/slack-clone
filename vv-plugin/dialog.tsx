import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './components.tsx';
export function Dialog({
  title,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
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
      aria-busy={busy}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <IconButton label="Close dialog" disabled={busy} onClick={onClose}>
          <X size={20} />
        </IconButton>
      </header>
      {children}
    </dialog>
  );
}
