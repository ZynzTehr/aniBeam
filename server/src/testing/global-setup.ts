// Loaded by npm test (--test-global-setup) before any server test file runs: starts the tests'
// throwaway Postgres and makes the template database, with the tables, that each test file's
// own database is copied from (see database.ts). The test files' processes find it through
// ANIBEAM_TEST_PG.
// Without Postgres this throws, saying how to install it, and the run fails: it never skips.
import pg from 'pg'
import { startCluster, type Cluster } from '../db/cluster.ts'
import { migrate, MIGRATIONS } from '../db/migrate.ts'
import { TEMPLATE } from './database.ts'

let cluster: Cluster | undefined

export async function globalSetup() {
  cluster = await startTestPostgres()
  process.env.ANIBEAM_TEST_PG = cluster.url
}

export function globalTeardown() {
  cluster?.stop()
}

/**
 * Starts a cluster under `parent` and makes the template in it from the files in `migrations`.
 * If that fails, as a migration with a typo does, the cluster is stopped and its folder deleted
 * before the error goes on: the test runner never calls globalTeardown after a failed
 * globalSetup, so nothing else would.
 */
export async function startTestPostgres({
  parent,
  migrations = MIGRATIONS,
}: { parent?: string; migrations?: URL } = {}) {
  const started = await startCluster({ parent })
  try {
    const admin = new pg.Client({ connectionString: started.url })
    await admin.connect()
    try {
      await admin.query(`CREATE DATABASE ${TEMPLATE}`)
    } finally {
      await admin.end()
    }
    // The migrations run once, on the template, so that every copy starts with the tables. A
    // copy can't be made while anything is connected to the template, so this closes its
    // connection.
    const url = new URL(started.url)
    url.pathname = `/${TEMPLATE}`
    const template = new pg.Client({ connectionString: url.href })
    await template.connect()
    try {
      await migrate(template, migrations)
    } finally {
      await template.end()
    }
  } catch (err) {
    started.stop()
    throw err
  }
  return started
}
