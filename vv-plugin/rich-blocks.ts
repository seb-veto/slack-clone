import type { z } from 'zod';
import type { delta } from './contract.ts';
export type RichAttributes = NonNullable<
  z.infer<typeof delta>['ops'][number]['attributes']
>;
export type Run = { text: string; attributes?: RichAttributes };
type Line = {
  runs: Run[];
  kind: 'text' | 'quote' | 'code' | 'ordered' | 'bullet';
  indent: number;
  language?: string;
};
export type ListBlock = {
  kind: 'list';
  ordered: boolean;
  indent: number;
  items: { runs: Run[]; children: ListBlock[] }[];
};
export type RichBlock =
  | ListBlock
  | {
      kind: 'text' | 'quote' | 'code';
      indent: number;
      language?: string;
      lines: Run[][];
    };

export function richBlocks(value: z.infer<typeof delta>): RichBlock[] {
  const lines: Line[] = [];
  let runs: Run[] = [];
  // Quill stores block formatting on the terminating newline.
  for (const op of value.ops) {
    const parts = op.insert.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) runs.push({ text: parts[i], attributes: op.attributes });
      if (i === parts.length - 1) continue;
      const a = op.attributes;
      lines.push({
        runs,
        kind: a?.['code-block']
          ? 'code'
          : a?.blockquote
            ? 'quote'
            : (a?.list ?? 'text'),
        indent: a?.indent ?? 0,
        language:
          typeof a?.['code-block'] === 'string' ? a['code-block'] : undefined,
      });
      runs = [];
    }
  }
  if (runs.length) lines.push({ runs, kind: 'text', indent: 0 });
  let at = 0;
  function list(): ListBlock {
    const first = lines[at];
    const block: ListBlock = {
      kind: 'list',
      ordered: first.kind === 'ordered',
      indent: first.indent,
      items: [],
    };
    while (at < lines.length) {
      const line = lines[at];
      if (
        !['ordered', 'bullet'].includes(line.kind) ||
        line.indent < block.indent
      )
        break;
      if (line.indent > block.indent) {
        block.items[block.items.length - 1].children.push(list());
      } else {
        if ((line.kind === 'ordered') !== block.ordered) break;
        block.items.push({ runs: line.runs, children: [] });
        at++;
      }
    }
    return block;
  }
  const blocks: RichBlock[] = [];
  while (at < lines.length) {
    const first = lines[at];
    if (first.kind === 'ordered' || first.kind === 'bullet') {
      blocks.push(list());
      continue;
    }
    const block: RichBlock = {
      kind: first.kind,
      indent: first.indent,
      language: first.language,
      lines: [],
    };
    while (
      at < lines.length &&
      lines[at].kind === first.kind &&
      lines[at].indent === first.indent &&
      lines[at].language === first.language
    )
      block.lines.push(lines[at++].runs);
    blocks.push(block);
  }
  return blocks;
}
