// GET /rooms/:roomKey/messages: a room's history, readable without signing in (spec section 7).
// Pages hold 50 messages, newest first, and ?before=<id> asks for the page older than that id.
// Ids, not times, mark the place: Postgres keeps times to the microsecond and JavaScript to the
// millisecond, so a time would skip messages, while ids grow in the order messages are added.
import { roomKeySchema, type ErrorCode } from '@anibeam/shared'
import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { FastifyInstance } from 'fastify'
import { messages, users } from '../db/schema.ts'

/** Messages a page holds. */
export const PAGE = 50

/** ?before=, a message id: digits from 1, no leading zero, and a whole number JavaScript holds. */
function cursor(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : undefined
}

export function historyRoutes(app: FastifyInstance, db: NodePgDatabase) {
  app.get<{ Params: { roomKey: string }; Querystring: { before?: unknown } }>(
    '/rooms/:roomKey/messages',
    async (request, reply) => {
      const room = roomKeySchema.safeParse(request.params.roomKey)
      const { before } = request.query
      const from = before === undefined ? undefined : cursor(before)
      if (!room.success || (before !== undefined && from === undefined))
        return reply.code(400).send({ error: 'invalid' satisfies ErrorCode })
      // One more than a page, to tell whether an older page follows. Drizzle sends the room key
      // and the id as parameters, apart from the SQL.
      const rows = await db
        .select({
          id: messages.id,
          roomKey: messages.roomKey,
          handle: users.handle,
          body: messages.body,
          spoiler: messages.spoiler,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .innerJoin(users, eq(users.id, messages.userId))
        .where(
          and(
            eq(messages.roomKey, room.data),
            isNull(messages.hiddenAt),
            from === undefined ? undefined : lt(messages.id, from),
          ),
        )
        .orderBy(desc(messages.id))
        .limit(PAGE + 1)
      const page = rows.slice(0, PAGE)
      return {
        // Handles only: never a user id or the sign-in's uid.
        messages: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        nextBefore: rows.length > PAGE ? page[PAGE - 1].id : null,
      }
    },
  )
}
