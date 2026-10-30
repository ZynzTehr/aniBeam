import { buildApp } from './app.ts'

// The chat server's entry: builds the app and listens.
const app = buildApp({ logger: true })

// A host stops the server with SIGTERM: stop taking requests, let the ones under way finish, and
// exit once nothing is left open.
process.once('SIGTERM', () => void app.close())

const port = Number(process.env.PORT ?? 3001)

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
