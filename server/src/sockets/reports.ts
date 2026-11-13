// message:report: a signed-in user with a handle reports someone else's message, and the third
// person's report hides it (moderation/reports.ts). The message's room, the reporter in it
// too, is then told with message:hidden { id, roomKey }, once.
import { messageReportSchema, type ErrorCode } from '@anibeam/shared'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { FastifyBaseLogger } from 'fastify'
import type { RateLimit } from '../moderation/rate-limit.ts'
import { report } from '../moderation/reports.ts'
import { acked } from './acked.ts'
import type { ChatServer, ChatSocket } from './sockets.ts'

/**
 * Listens for message:report on `socket`, recording to `db`, and tells rooms through `io`.
 * `reports` is the app's limit of REPORT_LIMIT, one for all its sockets, as for sends.
 */
export function reportEvents(
  socket: ChatSocket,
  io: ChatServer,
  db: NodePgDatabase,
  log: FastifyBaseLogger,
  reports: RateLimit,
) {
  // { id, reason }: {ok: true} once the report is recorded, or was already. Each check comes in
  // this order, and the first that fails answers: the payload (invalid), the sign-in
  // (sign-in-required), the user's reports in the last minute (rate-limited, with retryAfterMs),
  // then the transaction's: a user with a handle (handle-required) who isn't banned (banned), a
  // message that is there and not hidden (not-found), and someone else's (cannot-report-own). A
  // report that gets as far as the limit counts toward it, as a send does. The socket needn't
  // be in the message's room. A failure answers server-error (acked.ts), and the room gets
  // nothing.
  socket.on(
    'message:report',
    acked(log, async (payload) => {
      const parsed = messageReportSchema.safeParse(payload)
      if (!parsed.success) return { error: 'invalid' satisfies ErrorCode }
      const { uid } = socket.data
      if (uid === undefined) return { error: 'sign-in-required' satisfies ErrorCode }
      const retryAfterMs = reports.take(uid)
      if (retryAfterMs !== undefined)
        return { error: 'rate-limited' satisfies ErrorCode, retryAfterMs }
      const answer = await report(db, uid, parsed.data)
      if (typeof answer === 'string') return { error: answer }
      // The transaction has committed, so history leaves the message out by now. io.to, not
      // socket.to: the reporter's socket, if it is in the room, takes the message down too.
      if (answer.hidden) io.to(answer.hidden.roomKey).emit('message:hidden', answer.hidden)
      return { ok: true }
    }),
  )
}
