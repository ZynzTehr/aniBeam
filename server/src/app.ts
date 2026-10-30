import Fastify from 'fastify'

// The chat server's routes, without listening, so that tests can call them through app.inject.
// Chat routes, sockets, database and auth are added in Phase 6.
export function buildApp(options: { logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? false })

  app.get('/health', async () => ({ ok: true }))

  return app
}
