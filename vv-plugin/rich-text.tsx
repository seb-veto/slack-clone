import { Fragment, type ReactNode } from 'react';
import type { Message } from './contract.ts';
import { richBlocks, type Run, type ListBlock } from './rich-blocks.ts';

function inline(runs: Run[]) {
  return runs.length ? (
    runs.map((run, index) => {
      let content: ReactNode = run.text;
      const a = run.attributes;
      if (a?.bold) content = <strong>{content}</strong>;
      if (a?.italic) content = <em>{content}</em>;
      if (a?.underline) content = <u>{content}</u>;
      if (a?.strike) content = <s>{content}</s>;
      if (a?.code) content = <code>{content}</code>;
      if (a?.link && /^https?:\/\//i.test(a.link))
        content = (
          <a href={a.link} target="_blank" rel="noopener noreferrer">
            {content}
          </a>
        );
      return <Fragment key={index}>{content}</Fragment>;
    })
  ) : (
    <br />
  );
}
function lines(value: Run[][]) {
  return value.map((runs, index) => <div key={index}>{inline(runs)}</div>);
}
function List({ block, parent = -1 }: { block: ListBlock; parent?: number }) {
  const Tag = block.ordered ? 'ol' : 'ul';
  return (
    <Tag
      style={{ marginInlineStart: Math.max(0, block.indent - parent - 1) * 24 }}
    >
      {block.items.map((item, index) => (
        <li key={index}>
          {inline(item.runs)}
          {item.children.map((child, i) => (
            <List key={i} block={child} parent={block.indent} />
          ))}
        </li>
      ))}
    </Tag>
  );
}
export function RichText({ message }: { message: Message }) {
  if (!message.rich)
    return <div className="slack-message-text">{message.text}</div>;
  return (
    <div className="slack-message-text slack-rich-blocks">
      {richBlocks(message.rich).map((block, index) => {
        if (block.kind === 'list') return <List key={index} block={block} />;
        const style = { marginInlineStart: block.indent * 24 };
        if (block.kind === 'code')
          return (
            <pre key={index} style={style} data-language={block.language}>
              <code>
                {block.lines
                  .map((line) => line.map((run) => run.text).join(''))
                  .join('\n')}
              </code>
            </pre>
          );
        if (block.kind === 'quote')
          return (
            <blockquote key={index} style={style}>
              {lines(block.lines)}
            </blockquote>
          );
        return (
          <div key={index} style={style}>
            {lines(block.lines)}
          </div>
        );
      })}
    </div>
  );
}
