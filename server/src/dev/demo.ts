// npm run demo:chat: the chat server for trying it on this computer, with the dev sign-in
// (verify.ts), where the token dev:<name> signs in as that name. Its database is a throwaway
// Postgres of its own (src/db/cluster.ts), deleted when it stops, or DATABASE_URL's if one is
// given; either way it runs the migrations first. Since anyone can sign in as anyone, it listens
// on 127.0.0.1 only, which no other computer reaches, refuses NODE_ENV=production, and is left
// out of dist/. Ctrl-C (SIGINT), SIGTERM or closing its terminal (SIGHUP) stops it.
import pg from 'pg'
import { buildApp } from '../app.ts'
import { startCluster } from '../db/cluster.ts'
import { migrate } from '../db/migrate.ts'
import { devVerifier } from './verify.ts'

if (process.env.NODE_ENV === 'production') {
  console.error(
    'The dev entry lets anyone sign in as anyone, so it refuses to start with NODE_ENV=production. A real server starts with npm start.',
  )
  process.exit(1)
}

// Set before anything starts, so that a Ctrl-C while Postgres starts is heard too.
let app: ReturnType<typeof buildApp> | undefined
let stopping: Promise<void> | undefined
/** Stops taking requests and closes the pool, then exits, which deletes the throwaway Postgres. */
function stop(code: number) {
  stopping ??= (async () => {
    try {
      await app?.close()
    } finally {
      // cluster.ts deletes its folder, and stops its Postgres, as the process exits.
      process.exit(code)
    }
  })()
  return stopping
}
// Ctrl-C under npm run comes twice, from the terminal and from npm passing it on, and a second
// SIGINT with no listener would end the process before the Postgres is deleted, so the listeners
// stay for every signal and the stop runs once. Closing the terminal sends SIGHUP, which with no
// listener ends the process with no exit, leaving the Postgres running: pg_ctl starts it apart
// from the terminal, so it gets no SIGHUP of its own.
process.on('SIGINT', () => void stop(0))
process.on('SIGTERM', () => void stop(0))
process.on('SIGHUP', () => void stop(0))

try {
  const given = process.env.DATABASE_URL
  const cluster = given ? undefined : await startCluster()
  const pool = new pg.Pool({ connectionString: given || cluster?.url })
  app = buildApp({ logger: true, pool, verify: devVerifier })
  app.addHook('onClose', () => pool.end())
  // As in src/index.ts: an idle connection Postgres ends must not end the process.
  const log = app.log
  pool.on('error', (err: Error & { code?: string }) =>
    log.error({ code: err.code }, `An idle database connection failed: ${err.message}`),
  )
  const client = await pool.connect()
  try {
    const ran = await migrate(client)
    log.info(`Migrations run: ${ran.length > 0 ? ran.join(', ') : 'none needed'}`)
  } finally {
    client.release()
  }
  log.info(
    cluster
      ? `Database: a throwaway Postgres in ${cluster.dir}, deleted when this stops`
      : 'Database: DATABASE_URL',
  )
  // PORT is for the tests, which ask for a free one with 0. The host is fixed.
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: '127.0.0.1' })
  log.info('Dev sign-in: send Authorization: Bearer dev:<name>. Ctrl-C stops the server.')
} catch (err) {
  console.error(err)
  await stop(1)
}
