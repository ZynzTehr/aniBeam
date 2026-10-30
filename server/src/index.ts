import pg from 'pg'
import { buildApp } from './app.ts'

// The chat server's entry: builds the app and listens. The database is at DATABASE_URL; the pool
// connects at the first query, so the server starts (and answers /health) without one.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const app = buildApp({ logger: true, pool })
app.addHook('onClose', () => pool.end())
// Postgres can end a connection the pool holds idle, as a restart or a host that cuts idle
// connections does. The pool lets that connection go, the next query opens a new one, and the
// error comes here: unheard, it would end the process. The log keeps its code and message, not
// the error whole, which carries the pool's client with the database's name and address.
pool.on('error', (err: Error & { code?: string }) =>
  app.log.error({ code: err.code }, `An idle database connection failed: ${err.message}`),
)

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
