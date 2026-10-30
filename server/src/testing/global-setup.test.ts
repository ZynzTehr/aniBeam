import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { globalSetup, globalTeardown, startTestPostgres } from './global-setup.ts'

/** The pids of the processes whose command line names `folder`: a Postgres running in it. */
function postgresIn(folder: string) {
  try {
    return execFileSync('pgrep', ['-f', folder], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    // pgrep exits 1 when nothing matches.
    return []
  }
}

test('a migration that fails stops the throwaway Postgres and deletes its folder', async (t) => {
  const parent = mkdtempSync(path.join(tmpdir(), 'anibeam-setup-'))
  const migrations = mkdtempSync(path.join(tmpdir(), 'anibeam-migrations-'))
  writeFileSync(path.join(migrations, '0001_broken.sql'), 'create table broken (;')
  // Whatever happens below, nothing of this test is left running, without relying on the code
  // under test to stop it.
  t.after(() => {
    for (const pid of postgresIn(parent)) process.kill(Number(pid), 'SIGQUIT')
    rmSync(parent, { recursive: true, force: true })
    rmSync(migrations, { recursive: true, force: true })
  })

  await assert.rejects(
    startTestPostgres({ parent, migrations: pathToFileURL(`${migrations}/`) }),
    /Migration 0001_broken\.sql failed/,
  )
  assert.deepEqual(readdirSync(parent), [], 'its folder was deleted')
  assert.deepEqual(postgresIn(parent), [], 'its Postgres was stopped')
})

test('the global teardown stops the Postgres the global setup started, and deletes its folder', async (t) => {
  // The setup makes its cluster in the system's temp folder, which TMPDIR names.
  const parent = mkdtempSync(path.join(tmpdir(), 'anibeam-teardown-'))
  const before = { TMPDIR: process.env.TMPDIR, ANIBEAM_TEST_PG: process.env.ANIBEAM_TEST_PG }
  const restore = (name: keyof typeof before) => {
    if (before[name] === undefined) delete process.env[name]
    else process.env[name] = before[name]
  }
  t.after(() => {
    for (const pid of postgresIn(parent)) process.kill(Number(pid), 'SIGQUIT')
    rmSync(parent, { recursive: true, force: true })
    restore('ANIBEAM_TEST_PG')
  })
  process.env.TMPDIR = parent
  try {
    await globalSetup()
  } finally {
    restore('TMPDIR')
  }
  assert.equal(readdirSync(parent).length, 1, 'the setup made its folder')
  assert.notDeepEqual(postgresIn(parent), [], 'the setup started its Postgres')

  globalTeardown()
  assert.deepEqual(readdirSync(parent), [], 'its folder was deleted')
  assert.deepEqual(postgresIn(parent), [], 'its Postgres was stopped')
})
