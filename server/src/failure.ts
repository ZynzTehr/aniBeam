// A failure of the server's own, as the log keeps it: REST's (app.ts) and the sockets' (acked.ts).
import { DrizzleQueryError } from 'drizzle-orm/errors'
import type { FastifyBaseLogger } from 'fastify'

/**
 * Logs `err`. A failed query is logged without the values it was given, a user's uid, handle or
 * message among them, which Drizzle writes into its message and stack: the query, where it was
 * run from, and Postgres's code alone, since its message can quote a value.
 */
export function logFailure(log: FastifyBaseLogger, err: unknown) {
  if (err instanceof DrizzleQueryError) {
    const { code } = (err.cause ?? {}) as { code?: unknown }
    const at = err.stack?.split('\n').filter((line) => /^\s+at /.test(line))
    log.error({ query: err.query, code, at }, 'A database query failed')
  } else log.error(err)
}
