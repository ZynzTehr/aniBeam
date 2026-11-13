// message:send: a signed-in user with a handle posts to a room its socket is in, at most 5
// messages in any 10 s. The message is saved first; the sender's ack then carries it, and the
// room's other sockets get it as message:new. The sender gets it from its ack alone, never from
// message:new as well.
import { messageSendSchema, type ErrorCode, type MessageSend } from '@anibeam/shared'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { FastifyBaseLogger } from 'fastify'
import type { RateLimit } from '../moderation/rate-limit.ts'
import { acked } from './acked.ts'
import type { ChatSocket } from './sockets.ts'

/**
 * How many messages one user may send in any 10 s, from all their sockets together (spec section
 * 7), for rateLimit() (moderation/rate-limit.ts).
 */
export const SEND_LIMIT = { limit: 5, windowMs: 10_000 }

/** A saved message as clients get it, the shape of history's (routes/history.ts): a handle, never a user id. */
export interface ChatMessage {
  id: number
  roomKey: string
  handle: string
  body: string
  spoiler: boolean
  /** The time it was saved, as an ISO string. */
  createdAt: string
}

/**
 * Saves `message` as the user whose sign-in is `uid`, and gives it back as clients get it, or
 * undefined if the user has no row, and so no handle, yet. One statement: the insert takes the
 * user's id and handle from their row, which a handle and a user id in the payload could never
 * stand in for, and inserts nothing without one. Drizzle sends each value as a parameter, apart
 * from the SQL.
 */
async function save(db: NodePgDatabase, uid: string, message: MessageSend) {
  const { rows } = await db.execute<{
    id: string
    room_key: string
    handle: string
    body: string
    spoiler: boolean
    created_at: string
  }>(sql`
    insert into messages (room_key, user_id, body, spoiler)
    select ${message.roomKey}, users.id, ${message.body}, ${message.spoiler}
    from users where users.auth_uid = ${uid}
    returning id, room_key, (select handle from users where users.id = messages.user_id),
      body, spoiler, created_at`)
  const [row] = rows
  if (row === undefined) return undefined
  return {
    id: Number(row.id),
    roomKey: row.room_key,
    handle: row.handle,
    body: row.body,
    spoiler: row.spoiler,
    // Read as Drizzle reads the column for history, Postgres's text into a Date, so that both
    // give the same time.
    createdAt: new Date(row.created_at).toISOString(),
  } satisfies ChatMessage
}

/**
 * Listens for message:send on `socket`, saving to `db`. `sends` is the app's limit of SEND_LIMIT,
 * one for all its sockets, so that a user's tabs share theirs.
 */
export function messageEvents(
  socket: ChatSocket,
  db: NodePgDatabase,
  log: FastifyBaseLogger,
  sends: RateLimit,
) {
  // { roomKey, body, spoiler }: {ok: true, message} once the message is saved. Each check comes
  // in this order, and the first that fails answers: the payload (invalid), the sign-in
  // (sign-in-required), the room (not-joined), the user's sends in the last 10 s (rate-limited,
  // with retryAfterMs, the ms until another may be sent), then the user's handle
  // (handle-required). A send that gets as far as the limit counts toward it, even if a later
  // check refuses it. A failure to save answers server-error (acked.ts), and the room gets
  // nothing.
  socket.on(
    'message:send',
    acked(
      log,
      async (payload) => {
        const parsed = messageSendSchema.safeParse(payload)
        if (!parsed.success) return { error: 'invalid' satisfies ErrorCode }
        const { uid } = socket.data
        if (uid === undefined) return { error: 'sign-in-required' satisfies ErrorCode }
        if (!socket.rooms.has(parsed.data.roomKey))
          return { error: 'not-joined' satisfies ErrorCode }
        const retryAfterMs = sends.take(uid)
        if (retryAfterMs !== undefined)
          return { error: 'rate-limited' satisfies ErrorCode, retryAfterMs }
        const message = await save(db, uid, parsed.data)
        if (message === undefined) return { error: 'handle-required' satisfies ErrorCode }
        return { ok: true, message }
      },
      // After the ack, the room's other sockets: socket.to leaves the sender out, where io.to
      // would send it its own message a second time.
      (answer) => {
        const { message } = answer
        if (message) socket.to(message.roomKey).emit('message:new', message)
      },
    ),
  )
}
