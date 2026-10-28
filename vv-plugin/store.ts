import { randomUUID } from 'node:crypto';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import type { z } from 'zod';
import {
  delta,
  file,
  message,
  roomInput,
  sendInput,
  type Message,
  type Member,
  type Room,
} from './contract.ts';

export function createStore(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE members (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL);
     CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, createdAt INTEGER NOT NULL, recipient TEXT, creator TEXT NOT NULL);
     CREATE TABLE messages (id TEXT PRIMARY KEY, roomId TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL, rich TEXT, parentId TEXT, createdAt INTEGER NOT NULL, editedAt INTEGER, deleted INTEGER NOT NULL DEFAULT 0, attachment TEXT);
     CREATE INDEX message_room ON messages(roomId,createdAt);
     CREATE TABLE reactions (messageId TEXT NOT NULL, memberId TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY(messageId,memberId,emoji));
     CREATE TABLE saved (messageId TEXT NOT NULL, memberId TEXT NOT NULL, PRIMARY KEY(messageId,memberId));
     CREATE TABLE reads (roomId TEXT NOT NULL, memberId TEXT NOT NULL, through INTEGER NOT NULL, PRIMARY KEY(roomId,memberId));
     CREATE TABLE drafts (key TEXT NOT NULL, memberId TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(key,memberId));
     CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  ]);
  const getSetting = (key: string) =>
    (
      db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
        { value: string } | undefined
    )?.value;
  function actor(threadId?: string | null): Member {
    const memberId = threadId ? `agent:${threadId}` : 'human';
    db.prepare('INSERT OR IGNORE INTO members VALUES (?,?,?)').run(
      memberId,
      threadId ? `Agent · ${threadId.slice(-8)}` : 'You',
      threadId ? 'agent' : 'human',
    );
    return db
      .prepare('SELECT * FROM members WHERE id=?')
      .get(memberId) as Member;
  }
  actor();
  db.prepare('INSERT OR IGNORE INTO rooms VALUES (?,?,?,?,?,?)').run(
    'general',
    'general',
    'A place for the whole team to share updates and work together.',
    Date.now(),
    null,
    'human',
  );
  function access(roomId: string, who: string) {
    const row = db.prepare('SELECT * FROM rooms WHERE id=?').get(roomId) as
      (Room & { creator: string }) | undefined;
    if (!row || (row.recipient && row.recipient !== who && row.creator !== who))
      throw new Error('Conversation not available.');
    return row;
  }
  const raw = (id: string) =>
    db.prepare('SELECT * FROM messages WHERE id=?').get(id) as
      Record<string, unknown> | undefined;
  function readMessage(id: string, who: string): Message {
    const row = raw(id);
    if (!row) throw new Error('Message not found.');
    access(row.roomId as string, who);
    const reactions: Message['reactions'] = [];
    for (const r of db
      .prepare('SELECT emoji,memberId FROM reactions WHERE messageId=?')
      .all(id) as { emoji: string; memberId: string }[]) {
      let group = reactions.find((g) => g.emoji === r.emoji);
      if (!group) {
        group = { emoji: r.emoji, members: [] };
        reactions.push(group);
      }
      group.members.push(r.memberId);
    }
    const attachment = row.attachment
      ? file.parse(JSON.parse(row.attachment as string))
      : null;
    return message.parse({
      ...row,
      rich: row.rich ? JSON.parse(row.rich as string) : null,
      deleted: !!row.deleted,
      attachment: attachment
        ? { name: attachment.name, mime: attachment.mime }
        : null,
      reactions,
      saved: !!db
        .prepare('SELECT 1 FROM saved WHERE messageId=? AND memberId=?')
        .get(id, who),
    });
  }
  function listRooms(who: string): Room[] {
    return (
      db
        .prepare(
          'SELECT * FROM rooms WHERE recipient IS NULL OR recipient=? OR creator=? ORDER BY createdAt,id',
        )
        .all(who, who) as Room[]
    ).map((r) => ({
      ...r,
      name: r.recipient
        ? (
            db
              .prepare('SELECT name FROM members WHERE id=?')
              .get(r.creator === who ? r.recipient : r.creator) as {
              name: string;
            }
          ).name
        : r.name,
      unread: (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM messages WHERE roomId=? AND author<>? AND deleted=0 AND createdAt>COALESCE((SELECT through FROM reads WHERE roomId=? AND memberId=?),0)',
          )
          .get(r.id, who, r.id, who) as { count: number }
      ).count,
    }));
  }
  function createRoom(input: z.infer<typeof roomInput>, who: string): Room {
    const v = roomInput.parse(input);
    if (v.recipient) {
      if (
        v.recipient === who ||
        !db.prepare('SELECT 1 FROM members WHERE id=?').get(v.recipient)
      )
        throw new Error('Choose an existing teammate.');
      const existing = db
        .prepare(
          'SELECT id FROM rooms WHERE (creator=? AND recipient=?) OR (creator=? AND recipient=?)',
        )
        .get(who, v.recipient, v.recipient, who) as { id: string } | undefined;
      if (existing) return listRooms(who).find((r) => r.id === existing.id)!;
    } else if (!/^[a-z0-9][a-z0-9_-]*$/.test(v.name))
      throw new Error(
        'Use lowercase letters, numbers, hyphens or underscores.',
      );
    if (
      !v.recipient &&
      db
        .prepare('SELECT 1 FROM rooms WHERE name=? AND recipient IS NULL')
        .get(v.name)
    )
      throw new Error('That channel already exists.');
    const id = randomUUID();
    db.prepare('INSERT INTO rooms VALUES (?,?,?,?,?,?)').run(
      id,
      v.name,
      v.description,
      Date.now(),
      v.recipient ?? null,
      who,
    );
    return listRooms(who).find((r) => r.id === id)!;
  }
  function send(input: z.infer<typeof sendInput>, who: string): Message {
    const v = sendInput.parse(input);
    access(v.roomId, who);
    const existing = raw(v.id);
    if (existing) {
      const original = existing.attachment
        ? JSON.parse(existing.attachment as string)
        : null;
      if (
        existing.author !== who ||
        existing.roomId !== v.roomId ||
        existing.text !== v.text ||
        existing.parentId !== v.parentId ||
        existing.rich !== (v.rich ? JSON.stringify(v.rich) : null) ||
        JSON.stringify(original) !== JSON.stringify(v.attachment)
      )
        throw new Error(
          'Submission ID already belongs to a different message.',
        );
      return readMessage(v.id, who);
    }
    if (v.parentId) {
      const parent = readMessage(v.parentId, who);
      if (parent.roomId !== v.roomId || parent.parentId || parent.deleted)
        throw new Error(
          'Reply to an available top-level message in this conversation.',
        );
    }
    if (
      v.rich &&
      v.rich.ops
        .map((op) => op.insert)
        .join('')
        .trim() !== v.text.trim()
    )
      throw new Error('Formatted content does not match the message.');
    if (
      v.attachment &&
      Buffer.from(v.attachment.data, 'base64').length > 2 * 1024 * 1024
    )
      throw new Error('Files must be 2 MB or smaller.');
    db.prepare(
      'INSERT INTO messages (id,roomId,author,text,rich,parentId,createdAt,attachment) VALUES (?,?,?,?,?,?,?,?)',
    ).run(
      v.id,
      v.roomId,
      who,
      v.text,
      v.rich ? JSON.stringify(v.rich) : null,
      v.parentId,
      Date.now(),
      v.attachment ? JSON.stringify(v.attachment) : null,
    );
    return readMessage(v.id, who);
  }
  function own(id: string, who: string) {
    const m = readMessage(id, who);
    if (m.author !== who || m.deleted)
      throw new Error('Only the author can change an available message.');
    return m;
  }
  return {
    actor,
    listRooms,
    createRoom,
    send,
    readMessage,
    snapshot(roomId: string | null, who: string) {
      if (roomId) access(roomId, who);
      const ids = roomId
        ? (db
            .prepare(
              'SELECT id FROM (SELECT id,createdAt FROM messages WHERE roomId=? ORDER BY createdAt DESC,rowid DESC LIMIT 300) ORDER BY createdAt,id',
            )
            .all(roomId) as { id: string }[])
        : [];
      return {
        workspace: getSetting('workspace') ?? 'VV',
        me: db.prepare('SELECT * FROM members WHERE id=?').get(who) as Member,
        members: db
          .prepare('SELECT * FROM members ORDER BY kind DESC,name')
          .all() as Member[],
        rooms: listRooms(who),
        messages: ids.map((m) => readMessage(m.id, who)),
      };
    },
    edit(
      v: { id: string; text: string; rich: z.infer<typeof delta> | null },
      who: string,
    ) {
      own(v.id, who);
      if (
        v.rich &&
        v.rich.ops
          .map((op) => op.insert)
          .join('')
          .trim() !== v.text.trim()
      )
        throw new Error('Formatted content does not match the message.');
      db.prepare('UPDATE messages SET text=?,rich=?,editedAt=? WHERE id=?').run(
        v.text,
        v.rich ? JSON.stringify(v.rich) : null,
        Date.now(),
        v.id,
      );
      return readMessage(v.id, who);
    },
    remove(id: string, who: string) {
      own(id, who);
      db.transaction(() => {
        db.prepare(
          "UPDATE messages SET text='',rich=NULL,attachment=NULL,deleted=1 WHERE id=?",
        ).run(id);
        db.prepare('DELETE FROM reactions WHERE messageId=?').run(id);
        db.prepare('DELETE FROM saved WHERE messageId=?').run(id);
      })();
      return { ok: true };
    },
    react(id: string, emoji: string, who: string) {
      if (readMessage(id, who).deleted) throw new Error('Message was deleted.');
      db.transaction(() => {
        const result = db
          .prepare(
            'DELETE FROM reactions WHERE messageId=? AND memberId=? AND emoji=?',
          )
          .run(id, who, emoji);
        if (!result.changes)
          db.prepare('INSERT INTO reactions VALUES (?,?,?)').run(
            id,
            who,
            emoji,
          );
      })();
      return readMessage(id, who);
    },
    save(id: string, who: string) {
      if (readMessage(id, who).deleted) throw new Error('Message was deleted.');
      db.transaction(() => {
        const result = db
          .prepare('DELETE FROM saved WHERE messageId=? AND memberId=?')
          .run(id, who);
        if (!result.changes)
          db.prepare('INSERT INTO saved VALUES (?,?)').run(id, who);
      })();
      return readMessage(id, who);
    },
    search(query: string, saved: boolean, who: string) {
      const roomIds = new Set(listRooms(who).map((r) => r.id));
      return (
        db
          .prepare(
            `SELECT id,roomId FROM messages WHERE deleted=0 AND instr(lower(text),lower(?))>0 ${saved ? 'AND id IN (SELECT messageId FROM saved WHERE memberId=?)' : ''} ORDER BY createdAt DESC LIMIT 300`,
          )
          .all(...(saved ? [query, who] : [query])) as {
          id: string;
          roomId: string;
        }[]
      )
        .filter((m) => roomIds.has(m.roomId))
        .slice(0, 100)
        .map((m) => readMessage(m.id, who));
    },
    markRead(roomId: string, through: number, who: string) {
      access(roomId, who);
      db.prepare(
        'INSERT INTO reads VALUES (?,?,?) ON CONFLICT(roomId,memberId) DO UPDATE SET through=MAX(through,excluded.through)',
      ).run(roomId, who, Math.min(through, Date.now()));
      return { ok: true };
    },
    draft(
      key: string,
      value: z.infer<typeof delta> | null | undefined,
      who: string,
    ) {
      if (value !== undefined) {
        if (value === null)
          db.prepare('DELETE FROM drafts WHERE key=? AND memberId=?').run(
            key,
            who,
          );
        else
          db.prepare(
            'INSERT INTO drafts VALUES (?,?,?) ON CONFLICT(key,memberId) DO UPDATE SET value=excluded.value',
          ).run(key, who, JSON.stringify(value));
      }
      const row = db
        .prepare('SELECT value FROM drafts WHERE key=? AND memberId=?')
        .get(key, who) as { value: string } | undefined;
      return row ? delta.parse(JSON.parse(row.value)) : null;
    },
    settings(workspace: string, name: string) {
      db.transaction(() => {
        db.prepare(
          'INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        ).run('workspace', workspace);
        db.prepare('UPDATE members SET name=? WHERE id=?').run(name, 'human');
      })();
      return { ok: true };
    },
    attachment(id: string, who: string) {
      readMessage(id, who);
      const row = raw(id);
      if (!row?.attachment) throw new Error('Attachment unavailable.');
      return file.parse(JSON.parse(row.attachment as string));
    },
  };
}
