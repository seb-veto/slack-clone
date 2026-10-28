import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentConversations } from '../navigation-data.ts';
import type { Room } from '../contract.ts';
test('recent history deduplicates, filters unavailable rooms, keeps actual stack indexes and current identity', () => {
  const rooms = Array.from({ length: 25 }, (_, i) => ({
    id: String(i),
    name: `room-${i}`,
    recipient: null,
    description: '',
    createdAt: 0,
    creator: 'human',
    unread: 0,
  })) satisfies Room[];
  const history = ['missing', '0', '1', '0', '2'];
  const result = recentConversations(history, 1, rooms);
  assert.deepEqual(
    result.map((r) => [r.room.id, r.index, r.current]),
    [
      ['2', 4, false],
      ['0', 3, true],
      ['1', 2, false],
    ],
  );
  assert.deepEqual(history, ['missing', '0', '1', '0', '2']);
  assert.equal(
    recentConversations(
      rooms.map((r) => r.id),
      24,
      rooms,
    ).length,
    20,
  );
  assert.deepEqual(recentConversations(['missing'], 0, rooms), []);
});
