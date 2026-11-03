// The tables as server/migrations makes them, for Drizzle's typed queries. The SQL files are what
// changes the tables; this file only describes them, and schema.test.ts checks that it still
// matches the real ones (each column, constraint and index, as Postgres writes them out).
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const users = pgTable(
  'users',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    authUid: text('auth_uid').notNull().unique('users_auth_uid_key'),
    handle: text('handle').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    bannedAt: timestamp('banned_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_handle_lower_key').on(sql`lower(${t.handle})`)],
)

export const messages = pgTable(
  'messages',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    roomKey: text('room_key').notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    body: text('body').notNull(),
    spoiler: boolean('spoiler').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: 'messages_user_id_fkey', columns: [t.userId], foreignColumns: [users.id] }),
    check('messages_body_check', sql`char_length(${t.body}) between 1 and 500`),
    index('messages_room_key_id_idx').on(t.roomKey, t.id.desc()),
  ],
)

export const reports = pgTable(
  'reports',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    messageId: bigint('message_id', { mode: 'number' }).notNull(),
    reporterId: bigint('reporter_id', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'reports_message_id_fkey',
      columns: [t.messageId],
      foreignColumns: [messages.id],
    }),
    foreignKey({
      name: 'reports_reporter_id_fkey',
      columns: [t.reporterId],
      foreignColumns: [users.id],
    }),
    check('reports_reason_check', sql`${t.reason} in ('spoiler', 'abuse', 'spam', 'other')`),
    unique('reports_message_id_reporter_id_key').on(t.messageId, t.reporterId),
  ],
)
