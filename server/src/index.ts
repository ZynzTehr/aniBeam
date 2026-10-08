import Fastify from 'fastify'

// Phase 0 stub: proves the chat server boots. Chat routes, sockets,
// database and auth are added in Phase 6.
const app = Fastify({ logger: true })

app.get('/health', async () => ({ ok: true }))

const port = Number(process.env.PORT ?? 3001)

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
