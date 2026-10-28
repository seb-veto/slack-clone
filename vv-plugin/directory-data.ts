import type { Member, Room } from './contract.ts';

export function directoryEntries(
  rooms: Room[],
  members: Member[],
  query: string,
) {
  const value = query.trim().toLowerCase();
  const matches = (entry: { name: string }) =>
    entry.name.toLowerCase().includes(value);
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
  return {
    channels: rooms
      .filter((room) => !room.recipient && matches(room))
      .sort(byName),
    people: members.filter(matches).sort(byName),
  };
}
