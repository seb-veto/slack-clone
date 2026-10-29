import type { BbPluginApi } from '@get-bb/plugin-sdk';
import type { z } from 'zod';
import type { Message } from './message-contract.ts';
import { todoCreate, todoUpdate, todoList, todo } from './todo-contract.ts';
type DB = ReturnType<BbPluginApi['storage']['database']>;
type Row = {
  id: string;
  owner: string;
  messageId: string | null;
  text: string;
  dueAt: number | null;
  completedAt: number | null;
  createdAt: number;
  destination: 'todos' | 'saved' | 'cleared';
  creation: string;
};
export const todoMigration = `CREATE TABLE todos (id TEXT PRIMARY KEY,owner TEXT NOT NULL,messageId TEXT,text TEXT NOT NULL,dueAt INTEGER,completedAt INTEGER,createdAt INTEGER NOT NULL,destination TEXT NOT NULL,creation TEXT NOT NULL);
CREATE INDEX todo_owner ON todos(owner,destination,createdAt);
CREATE UNIQUE INDEX todo_active_message ON todos(owner,messageId) WHERE destination='todos' AND messageId IS NOT NULL;`;
export function createTodos(
  db: DB,
  readMessage: (id: string, who: string) => Message,
) {
  const eligible = `t.owner=? AND (t.messageId IS NULL OR EXISTS (SELECT 1 FROM messages m JOIN rooms r ON r.id=m.roomId WHERE m.id=t.messageId AND (r.recipient IS NULL OR r.creator=t.owner OR r.recipient=t.owner)))`;
  function row(id: string, who: string): Row {
    const v = db
      .prepare(`SELECT t.* FROM todos t WHERE t.id=? AND ${eligible}`)
      .get(id, who) as Row | undefined;
    if (!v) throw Error('To-do not available.');
    return v;
  }
  const render = (v: Row, who: string) =>
    todo.parse({
      ...v,
      message: v.messageId ? readMessage(v.messageId, who) : null,
    });
  return {
    list(input: z.input<typeof todoList>, who: string) {
      const v = todoList.parse(input),
        params: unknown[] = [who, v.destination];
      let filter = `${eligible} AND t.destination=?`;
      if (v.status !== 'all')
        filter +=
          v.status === 'completed'
            ? ' AND t.completedAt IS NOT NULL'
            : ' AND t.completedAt IS NULL';
      if (v.reminder === 'none') filter += ' AND t.dueAt IS NULL';
      if (v.reminder === 'overdue' || v.reminder === 'upcoming') {
        filter += ` AND t.dueAt ${v.reminder === 'overdue' ? '<=' : '>'} ?`;
        params.push(Date.now());
      }
      const order =
        v.sort === 'due'
          ? 't.completedAt IS NOT NULL,t.dueAt IS NULL,t.dueAt,t.createdAt,t.id'
          : `t.createdAt ${v.sort === 'newest' ? 'DESC' : 'ASC'},t.id`;
      const total = (
        db
          .prepare(`SELECT COUNT(*) count FROM todos t WHERE ${filter}`)
          .get(...params) as { count: number }
      ).count;
      const items = (
        db
          .prepare(
            `SELECT t.* FROM todos t WHERE ${filter} ORDER BY ${order} LIMIT 100 OFFSET ?`,
          )
          .all(...params, v.offset) as Row[]
      ).map((r) => render(r, who));
      return {
        items,
        total,
        nextOffset:
          v.offset + items.length < total ? v.offset + items.length : null,
      };
    },
    dueCount(who: string) {
      return (
        db
          .prepare(
            `SELECT COUNT(*) count FROM todos t WHERE ${eligible} AND destination='todos' AND completedAt IS NULL AND dueAt<=?`,
          )
          .get(who, Date.now()) as { count: number }
      ).count;
    },
    create(input: z.input<typeof todoCreate>, who: string) {
      const v = todoCreate.parse(input),
        creation = JSON.stringify(v);
      return db.transaction(() => {
        const old = db.prepare('SELECT * FROM todos WHERE id=?').get(v.id) as
          Row | undefined;
        if (old) {
          if (old.owner !== who || old.creation !== creation)
            throw Error('This ID belongs to a different to-do request.');
          return render(row(v.id, who), who);
        }
        if (v.messageId) {
          const m = readMessage(v.messageId, who);
          if (m.deleted) throw Error('Message was deleted.');
          if (
            db
              .prepare(
                "SELECT 1 FROM todos WHERE owner=? AND messageId=? AND destination='todos'",
              )
              .get(who, v.messageId)
          )
            throw Error('Message already has a to-do.');
        }
        db.prepare('INSERT INTO todos VALUES (?,?,?,?,?,?,?,?,?)').run(
          v.id,
          who,
          v.messageId,
          v.text,
          v.dueAt,
          null,
          Date.now(),
          'todos',
          creation,
        );
        if (v.messageId)
          db.prepare('DELETE FROM saved WHERE messageId=? AND memberId=?').run(
            v.messageId,
            who,
          );
        return render(row(v.id, who), who);
      })();
    },
    update(input: z.input<typeof todoUpdate>, who: string) {
      const v = todoUpdate.parse(input);
      return db.transaction(() => {
        const old = row(v.id, who);
        if (v.text !== undefined && old.messageId)
          throw Error('Edit the original message to change its text.');
        let destination = v.destination ?? old.destination;
        if (destination === 'saved' && old.messageId) {
          const m = readMessage(old.messageId, who);
          if (m.deleted) throw Error('Message was deleted.');
          db.prepare('INSERT OR IGNORE INTO saved VALUES (?,?)').run(
            old.messageId,
            who,
          );
          destination = 'cleared';
        }
        const completedAt =
          v.completed === undefined
            ? v.destination === 'todos'
              ? null
              : old.completedAt
            : v.completed
              ? (old.completedAt ?? Date.now())
              : null;
        db.prepare(
          'UPDATE todos SET text=?,dueAt=?,completedAt=?,destination=? WHERE id=?',
        ).run(
          v.text ?? old.text,
          v.dueAt === undefined ? old.dueAt : v.dueAt,
          completedAt,
          destination,
          v.id,
        );
        return render(row(v.id, who), who);
      })();
    },
  };
}
