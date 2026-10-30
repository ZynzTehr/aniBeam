import { drizzle } from 'drizzle-orm/node-postgres'
import Fastify from 'fastify'
import type pg from 'pg'
import { historyRoutes } from './routes/history.ts'

// The chat server's routes, without listening, so that tests can call them through app.inject.
// The routes that read the database come with a pool of connections to it; the pool belongs to
// the caller, who closes it. Sockets and auth are added later in Phase 6.
export function buildApp(options: { logger?: boolean; pool?: pg.Pool } = {}) {
  // 4 KB holds any request the chat makes (a message is at most 500 characters), and a body
  // larger than that is refused with 413 before it is read.
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 4096 })

  // A failure of ours (a 5xx) is logged, and answered without its message, which can hold the
  // SQL that failed. A refusal (a 4xx, such as 413) keeps Fastify's own answer.
  app.setErrorHandler((err: { statusCode?: number }, request, reply) => {
    if (err.statusCode !== undefined && err.statusCode < 500) throw err
    request.log.error(err)
    return reply.code(500).send({ statusCode: 500, error: 'Internal Server Error' })
  })

  app.get('/health', async () => ({ ok: true }))
  if (options.pool) historyRoutes(app, drizzle({ client: options.pool }))

  return app
}
