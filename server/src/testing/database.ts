// A database of a test file's own, so that test files running at once never see each other's
// rows. Each is copied from the template that global-setup.ts makes, which takes under 50 ms.
import pg from 'pg'

/** The database each test file's database is copied from. */
export const TEMPLATE = 'anibeam_template'

export interface TestDatabase {
  /** The database's address, for a client of the test's own. */
  url: string
  /** Connections to the database, closed by close(). */
  pool: pg.Pool
  close(): Promise<void>
}

/** Databases made by this test file so far, to name the next. */
let made = 0

/**
 * Makes a new database from the template, named for this test file's process. Call it in a
 * before() hook and close it in after(), since a file must await nothing at its top level after
 * its first test (see web/scripts/every-test-reported.ts).
 */
export async function testDatabase(): Promise<TestDatabase> {
  const admin = process.env.ANIBEAM_TEST_PG
  if (!admin)
    throw new Error(
      'No test Postgres: run the server tests with npm test, which starts one (src/testing/global-setup.ts)',
    )
  // Each test file runs in a process of its own, so its pid tells it from the files running
  // beside it. The name is ours, never a user's, so it can go into the SQL as it is.
  const name = `test_${process.pid}_${++made}`
  const client = new pg.Client({ connectionString: admin })
  await client.connect()
  try {
    await client.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE}`)
  } finally {
    await client.end()
  }
  const url = new URL(admin)
  url.pathname = `/${name}`
  const pool = new pg.Pool({ connectionString: url.href })
  return { url: url.href, pool, close: () => pool.end() }
}
