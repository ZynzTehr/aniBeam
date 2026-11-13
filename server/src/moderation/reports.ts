// Reports (spec section 7): a signed-in user with a handle reports someone else's message, once
// per message, and the third person to report it hides it. A hidden message stays in the table,
// with the time it was hidden, and history leaves it out (routes/history.ts).
import type { ErrorCode, MessageReport } from '@anibeam/shared'
import { sql } from 'drizzle-orm'
import type pg from 'pg'
import { transaction } from '../db/transaction.ts'

/** How many people's reports hide a message. */
export const HIDE_AT = 3

/**
 * How many reports one user may make in a minute, from all their sockets together, for
 * rateLimit() (rate-limit.ts).
 */
export const REPORT_LIMIT = { limit: 10, windowMs: 60_000 }

/** A message just hidden, as message:hidden tells its room. */
export interface Hidden {
  id: number
  roomKey: string
}

/**
 * Records the report `report` by the user whose sign-in is `uid`, and gives back the message if
 * this report hid it, undefined if it was counted and the message still shows, or the code that
 * says why it was refused. A second report of a message by the same user counts once, and keeps
 * the first's reason, and a report by a user banned since counts no more.
 *
 * One transaction, on a connection of `pool`'s (db/transaction.ts), which first locks the
 * message's row (FOR UPDATE), so that reports of one message are counted one after another.
 * Without the lock, three people reporting at the same moment would each insert their own
 * report, and each count before the others had committed: each would see 1, and none would hide
 * the message. With it, the second waits for the first to commit, then counts 2, and the third
 * counts 3. Only the transaction that sets hidden_at gives the message back, so the room is told
 * once.
 */
export async function report(
  pool: pg.Pool,
  uid: string,
  { id, reason }: MessageReport,
): Promise<
  | { hidden: Hidden | undefined }
  | Extract<ErrorCode, 'banned' | 'cannot-report-own' | 'handle-required' | 'not-found'>
> {
  return transaction(pool, async (tx) => {
    // A user with no row has no handle yet. The ban is read at each report, and the user's row
    // held (FOR SHARE) until the report commits: a ban made meanwhile, as while the report waits
    // on the message's lock below, waits for it. So a report is recorded only if its user isn't
    // banned when it commits, and a ban made first is seen. A row held FOR SHARE can still be
    // read, and the same user's other reports may hold it too.
    const { rows: users } = await tx.execute<{ id: string; banned: boolean }>(
      sql`select id, banned_at is not null as banned from users where auth_uid = ${uid} for share`,
    )
    const [user] = users
    if (user === undefined) return 'handle-required'
    if (user.banned) return 'banned'
    // A report waits here while another of the same message's is in its transaction, and then
    // reads the row as that one left it: a message it hid is not-found.
    const { rows: messages } = await tx.execute<{ user_id: string; room_key: string }>(
      sql`select user_id, room_key from messages
        where id = ${id} and hidden_at is null for update`,
    )
    const [message] = messages
    if (message === undefined) return 'not-found'
    if (message.user_id === user.id) return 'cannot-report-own'
    await tx.execute(sql`
      insert into reports (message_id, reporter_id, reason) values (${id}, ${user.id}, ${reason})
      on conflict (message_id, reporter_id) do nothing`)
    // Only the reports of users who aren't banned count. So once a moderator bans the accounts
    // that hid a message together, and shows it again, it stays up until others report it.
    const { rows: counted } = await tx.execute<{ count: number }>(
      sql`select count(*)::int as count from reports join users on users.id = reports.reporter_id
        where reports.message_id = ${id} and users.banned_at is null`,
    )
    if (counted[0].count < HIDE_AT) return { hidden: undefined }
    const { rows: hid } = await tx.execute(
      sql`update messages set hidden_at = now() where id = ${id} and hidden_at is null returning id`,
    )
    return { hidden: hid.length === 1 ? { id, roomKey: message.room_key } : undefined }
  })
}
