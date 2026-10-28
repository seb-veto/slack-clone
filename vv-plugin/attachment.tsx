import { useEffect, useRef, useState } from 'react';
import { useRpc } from '@get-bb/plugin-sdk/app';
import { Download, FileText } from 'lucide-react';
import type { z } from 'zod';
import { rpcContract, type file, type Message } from './contract.ts';

export function Attachment({
  message,
  onDownload,
  onPreview,
}: {
  message: Message;
  onDownload: () => void;
  onPreview: (value: z.infer<typeof file>) => void;
}) {
  const rpc = useRpc<typeof rpcContract>(),
    root = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<z.infer<typeof file> | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    if (!message.attachment?.mime.startsWith('image/') || !root.current) return;
    let live = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void rpc
          .call('attachment', { id: message.id })
          .then((value) => {
            if (live) setImage(value);
          })
          .catch(() => {
            if (live)
              setError(
                'Image preview unavailable. You can still try downloading the file.',
              );
          });
      },
      { rootMargin: '200px' },
    );
    observer.observe(root.current);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [rpc, message.id, message.attachment?.mime]);
  if (!message.attachment) return null;
  return (
    <div ref={root} className="slack-attachment">
      <button
        className="slack-file"
        type="button"
        title="Download attachment"
        aria-describedby="slack-key-help"
        onClick={onDownload}
      >
        <FileText size={26} />
        <span>
          <strong>{message.attachment.name}</strong>
          <small>{message.attachment.mime}</small>
        </span>
        <Download size={16} />
      </button>
      {image && !error && (
        <button
          type="button"
          className="slack-image-thumbnail"
          title="Preview image"
          aria-label={`Preview ${image.name}`}
          aria-describedby="slack-key-help"
          onClick={() => onPreview(image)}
        >
          <img
            src={`data:${image.mime};base64,${image.data}`}
            alt={image.name}
            onError={() =>
              setError(
                'This image could not be displayed. The original file is available to download.',
              )
            }
          />
        </button>
      )}
      {error && (
        <p role="status" className="slack-muted">
          {error}
        </p>
      )}
    </div>
  );
}
