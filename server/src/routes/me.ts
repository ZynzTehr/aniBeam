// GET /me and POST /me/handle: the signed-in user's chat account, and picking its handle. Who the
// user is comes from the token alone (auth/sign-in.ts): a uid in the body is refused, and one in
// a header or the address is never read.
import type { ErrorCode } from '@anibeam/shared'
import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { FastifyInstance } from 'fastify'
import { signIn } from '../auth/sign-in.ts'
import type { Verify } from '../auth/verify.ts'
import { users } from '../db/schema.ts'
import { hasBlockedWord } from '../moderation/word-filter.ts'

/**
 * A handle (D12): 3 to 20 of A to Z, a to z, 0 to 9 and _. Only ASCII, because lower() folds
 * other letters differently from one database to another, so the unique index that tells Aki
 * from aki could let two handles that look alike through.
 */
const HANDLE = /^[A-Za-z0-9_]{3,20}$/

/** The handle in a body that is { handle } and nothing else, if it is a handle. */
function handleIn(body: unknown) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'handle') return undefined
  const { handle } = body as { handle: unknown }
  return typeof handle === 'string' && HANDLE.test(handle) ? handle : undefined
}

export function meRoutes(app: FastifyInstance, db: NodePgDatabase, verify: Verify) {
  const signedIn = signIn(app, verify)

  // { handle, banned }: the handle is null until the user picks one, and a user with no row yet
  // isn't banned.
  app.get('/me', { onRequest: signedIn }, async (request) => {
    const [user] = await db
      .select({ handle: users.handle, bannedAt: users.bannedAt })
      .from(users)
      .where(eq(users.authUid, request.uid))
    return { handle: user?.handle ?? null, banned: user !== undefined && user.bannedAt !== null }
  })

  // { handle }: makes the user's row with it, which answers 201 and what GET /me would. A handle
  // is set once, and holds no word of the word filter's (handle-blocked). The row holds the uid
  // and the handle, never an email (spec section 5).
  app.post('/me/handle', { onRequest: signedIn }, async (request, reply) => {
    const handle = handleIn(request.body)
    if (handle === undefined) return reply.code(400).send({ error: 'invalid' satisfies ErrorCode })
    // A handle shows on every message, so the word filter reads it as it reads one: its parts
    // between _ and digits each a word, and its digits as leetspeak too (word-filter.ts).
    if (hasBlockedWord(handle))
      return reply.code(400).send({ error: 'handle-blocked' satisfies ErrorCode })
    // The unique indexes decide, not a look first: two requests at once could both find a handle
    // free. A row that clashes with one, on the uid or the handle in any case, is left unmade,
    // and an insert that meets a row another request hasn't saved yet waits to see if it is.
    const made = await db
      .insert(users)
      .values({ authUid: request.uid, handle })
      .onConflictDoNothing()
      .returning({ id: users.id })
    if (made.length > 0) return reply.code(201).send({ handle, banned: false })
    // Which clash it was: a row of this user's means the handle was set, by now if not before.
    const [mine] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.authUid, request.uid))
    const error: ErrorCode = mine ? 'handle-already-set' : 'handle-taken'
    return reply.code(409).send({ error })
  })
}
