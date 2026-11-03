// GET /me: the signed-in user's chat account, for the client to tell whether a handle is still
// to pick. Who the user is comes from the token alone (auth/sign-in.ts).
import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { FastifyInstance } from 'fastify'
import { signIn } from '../auth/sign-in.ts'
import type { Verify } from '../auth/verify.ts'
import { users } from '../db/schema.ts'

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
}
