// Loaded by npm test (--test-global-setup) before any server test file runs: starts the tests'
// throwaway Postgres and makes the template database that each test file's own database is
// copied from (see database.ts). The test files' processes find it through ANIBEAM_TEST_PG.
// Without Postgres this throws, saying how to install it, and the run fails: it never skips.
import pg from 'pg'
import { startCluster, type Cluster } from '../db/cluster.ts'
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
  // The template is where the migrations will run, once there are tables, so that every copy
  // starts with them.
  process.env.ANIBEAM_TEST_PG = cluster.url
}

export function globalTeardown() {
  cluster?.stop()
}
