// Loaded by npm test (--test-global-setup) before any server test file runs: starts the tests'
// throwaway Postgres and makes the template database, with the tables, that each test file's
// own database is copied from (see database.ts). The test files' processes find it through
// ANIBEAM_TEST_PG.
// Without Postgres this throws, saying how to install it, and the run fails: it never skips.
import pg from 'pg'
import { startCluster, type Cluster } from '../db/cluster.ts'
import { migrate } from '../db/migrate.ts'
import { TEMPLATE } from './database.ts'

let cluster: Cluster | undefined

export async function globalSetup() {
  cluster = await startCluster()
  const admin = new pg.Client({ connectionString: cluster.url })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE ${TEMPLATE}`)
  } finally {
    await admin.end()
  }
  // The migrations run once, on the template, so that every copy starts with the tables. A copy
  // can't be made while anything is connected to the template, so this closes its connection.
  const url = new URL(cluster.url)
  url.pathname = `/${TEMPLATE}`
  const template = new pg.Client({ connectionString: url.href })
  await template.connect()
  try {
    await migrate(template)
  } finally {
    await template.end()
  }
  process.env.ANIBEAM_TEST_PG = cluster.url
}

export function globalTeardown() {
  cluster?.stop()
}
