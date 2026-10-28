import type { Room } from './contract.ts';
export function recentConversations(
  history: string[],
  at: number,
  rooms: Room[],
) {
  const available = new Map(rooms.map((room) => [room.id, room]));
  const seen = new Set<string>();
  const recent: { room: Room; index: number; current: boolean }[] = [];
  for (
    let index = history.length - 1;
    index >= 0 && recent.length < 20;
    index--
  ) {
    const id = history[index],
      room = available.get(id);
    if (!room || seen.has(id)) continue;
    seen.add(id);
    recent.push({ room, index, current: id === history[at] });
  }
  return recent;
}
