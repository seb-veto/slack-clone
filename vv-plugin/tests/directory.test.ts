import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directoryEntries } from '../directory-data.ts';
import type { Room, Member } from '../contract.ts';

test('directory searches real supplied members and public channels without mutating navigation data', () => {
  const room = {
    description: '',
    createdAt: 0,
    creator: 'human',
    unread: 0,
    recipient: null,
  };
  const rooms: Room[] = [
    { ...room, id: 'z', name: 'zebra' },
    { ...room, id: 'private', name: 'Agent DM', recipient: 'agent:actual' },
    { ...room, id: 'a', name: 'Alpha' },
  ];
  const people: Member[] = [
    { id: 'human', name: 'You', kind: 'human' },
    { id: 'agent:actual', name: 'Agent · actual', kind: 'agent' },
  ];
  const all = directoryEntries(rooms, people, '');
  assert.deepEqual(
    all.channels.map((r) => r.id),
    ['a', 'z'],
  );
  assert.deepEqual(
    all.people.map((p) => p.id),
    ['agent:actual', 'human'],
  );
  assert.deepEqual(
    directoryEntries(rooms, people, '  ALP ').channels.map((r) => r.id),
    ['a'],
  );
  assert.deepEqual(
    directoryEntries(rooms, people, 'actual').people.map((p) => p.id),
    ['agent:actual'],
  );
  assert.equal(directoryEntries(rooms, people, 'Agent DM').channels.length, 0);
  assert.equal(directoryEntries(rooms, people, '<script>').people.length, 0);
  assert.deepEqual(
    rooms.map((r) => r.id),
    ['z', 'private', 'a'],
  );
  assert.deepEqual(
    people.map((p) => p.id),
    ['human', 'agent:actual'],
  );
});
