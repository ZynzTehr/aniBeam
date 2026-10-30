// Makes and changes the tables: runs the SQL files in server/migrations that haven't run yet, in
// name order, and records each in schema_migrations, so that each file runs exactly once. A file
// runs in one transaction with its record, so one that fails leaves nothing behind.
import { readdirSync, readFileSync } from 'node:fs'
import type pg from 'pg'

/** server/migrations, the same two folders up from src/db and from dist/db. */
export const MIGRATIONS = new URL('../../migrations/', import.meta.url)

/** Any number for pg_advisory_lock, so that two servers starting at once take turns. */
const LOCK = 7_204_401

/** Runs the files in `dir` that haven't run on this database, and returns their names. */
export async function migrate(client: pg.ClientBase, dir: URL = MIGRATIONS) {
  await client.query('select pg_advisory_lock($1)', [LOCK])
  try {
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    )
    const { rows } = await client.query<{ name: string }>('select name from schema_migrations')
    const applied = new Set(rows.map((row) => row.name))
    const files = readdirSync(dir).filter((name) => /^\d{4}_\w+\.sql$/.test(name))
    const ran: string[] = []
    for (const name of files.sort()) {
      if (applied.has(name)) continue
      await client.query('begin')
      try {
        await client.query(readFileSync(new URL(name, dir), 'utf8'))
        await client.query('insert into schema_migrations (name) values ($1)', [name])
        await client.query('commit')
      } catch (err) {
        await client.query('rollback')
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`, { cause: err })
      }
      ran.push(name)
    }
    return ran
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK])
  }
}
