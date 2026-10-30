import pg from 'pg'
import { buildApp } from './app.ts'

// The chat server's entry: builds the app and listens. The database is at DATABASE_URL; the pool
// connects at the first query, so the server starts (and answers /health) without one.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const app = buildApp({ logger: true, pool })
app.addHook('onClose', () => pool.end())

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
