// A transaction on a connection of its own, for queries that must run as one, such as a
// report's (moderation/reports.ts).
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type pg from 'pg'

/**
 * Runs `run` in a transaction on a connection taken from `pool`, commits, and gives what `run`
 * gave. If anything fails, it rolls back and throws, and the connection goes back to the pool.
 * While a connection is taken, the pool doesn't hear its errors: if Postgres ends it, as a
 * restart or a host cutting connections does, it says so with an 'error' event, and an 'error'
 * no one hears ends the whole process. So it is heard here, where the query waiting on it fails
 * too, and the broken connection is dropped from the pool rather than kept. Drizzle's own
 * db.transaction() hears none, and keeps the connection for good if `begin` itself fails.
 */
export async function transaction<T>(pool: pg.Pool, run: (tx: NodePgDatabase) => Promise<T>) {
  const client = await pool.connect()
  let broken: Error | undefined
  const heard = (err: Error) => {
    broken = err
  }
  client.on('error', heard)
  try {
    await client.query('begin')
    const result = await run(drizzle({ client }))
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch((failed: Error) => {
      broken ??= failed
    })
    throw err
  } finally {
    client.off('error', heard)
    // With an error, the pool closes the connection instead of keeping it.
    client.release(broken)
  }
}
