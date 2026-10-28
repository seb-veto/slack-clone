import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richBlocks } from '../rich-blocks.ts';
import { delta } from '../contract.ts';

test('Quill newline attributes preserve inline runs, nested mixed lists and block boundaries', () => {
  const value = delta.parse({
    ops: [
      { insert: 'underlined', attributes: { underline: true } },
      { insert: '\n' },
      { insert: 'first\n', attributes: { list: 'ordered' } },
      { insert: 'nested\n', attributes: { list: 'bullet', indent: 2 } },
      { insert: 'second\n', attributes: { list: 'ordered' } },
      { insert: 'bullet\n', attributes: { list: 'bullet' } },
      { insert: 'quote\ncontinued\n', attributes: { blockquote: true } },
      {
        insert: '<script>\nconst x = 1;\n',
        attributes: { 'code-block': 'plain' },
      },
      { insert: 'tail' },
    ],
  });
  const blocks = richBlocks(value);
  assert.equal(blocks.length, 6);
  assert.deepEqual(blocks[0], {
    kind: 'text',
    indent: 0,
    language: undefined,
    lines: [[{ text: 'underlined', attributes: { underline: true } }]],
  });
  const ordered = blocks[1];
  assert.equal(ordered.kind, 'list');
  if (ordered.kind !== 'list') throw Error('Expected ordered list');
  assert.equal(ordered.ordered, true);
  assert.equal(ordered.items.length, 2);
  assert.equal(ordered.items[0].children[0].indent, 2);
  assert.equal(ordered.items[0].children[0].ordered, false);
  assert.equal(ordered.items[0].children[0].items[0].runs[0].text, 'nested');
  assert.equal(blocks[2].kind, 'list');
  assert.equal(blocks[3].kind, 'quote');
  assert.equal(blocks[4].kind, 'code');
  if (blocks[4].kind === 'code') assert.equal(blocks[4].lines.length, 2);
  assert.equal(blocks[5].kind, 'text');
});

test('blank lines, split inline styles and trust-boundary validation remain intact', () => {
  const blocks = richBlocks(
    delta.parse({
      ops: [
        { insert: 'a', attributes: { bold: true } },
        { insert: 'b', attributes: { italic: true } },
        { insert: '\n\nlast\n' },
      ],
    }),
  );
  assert.equal(blocks.length, 1);
  if (blocks[0].kind !== 'text') throw Error('Expected text');
  assert.equal(blocks[0].lines.length, 3);
  assert.equal(blocks[0].lines[0].length, 2);
  assert.deepEqual(blocks[0].lines[1], []);
  assert.equal(
    delta.safeParse({
      ops: [{ insert: 'link', attributes: { link: 'HTTPS://example.com' } }],
    }).success,
    true,
  );
  for (const op of [
    { insert: '\n', attributes: { indent: 9 } },
    { insert: '\n', attributes: { indent: -1 } },
    { insert: 'link', attributes: { link: 'javascript:alert(1)' } },
    { insert: { image: 'https://example.com' } },
  ])
    assert.equal(delta.safeParse({ ops: [op] }).success, false);
});

test('pending draft recovery keeps newer edits and explicit clears until acknowledged', async () => {
  const { recoverDraft, retainDraft, acknowledgeDraft } =
    await import('../draft-recovery.ts');
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const old = { ops: [{ insert: 'old\n' }] };
  const newer = {
    ops: [{ insert: 'new\n', attributes: { list: 'bullet' as const } }],
  };
  retainDraft(storage, 'room|main', old);
  retainDraft(storage, 'room|main', newer);
  acknowledgeDraft(storage, 'room|main', old);
  assert.deepEqual(recoverDraft(storage, 'room|main')?.value, newer);
  assert.equal(recoverDraft(storage, 'room|thread'), undefined);
  retainDraft(storage, 'room|main', null);
  assert.deepEqual(recoverDraft(storage, 'room|main'), { value: null });
  acknowledgeDraft(storage, 'room|main', newer);
  assert.deepEqual(recoverDraft(storage, 'room|main'), { value: null });
  acknowledgeDraft(storage, 'room|main', null);
  assert.equal(recoverDraft(storage, 'room|main'), undefined);
  storage.setItem('vv-slack:pending-draft:room|main', '{broken');
  assert.equal(recoverDraft(storage, 'room|main'), undefined);
});
