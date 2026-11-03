import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'
import type pg from 'pg'
import { testDatabase } from '../testing/database.ts'
import { migrate } from './migrate.ts'

/** A database with no tables, as a new server's starts, and a client of its own on it. */
async function emptyDatabase(t: TestContext) {
  const db = await testDatabase({ template: 'template0' })
  const client = await db.pool.connect()
  t.after(async () => {
    client.release()
    await db.close()
  })
  return client
}

/** A folder of migration files, deleted after the test. */
function folder(t: TestContext, files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'anibeam-migrations-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql)
  return pathToFileURL(`${dir}/`)
}

/** The tables in a database, by name. */
async function tables(client: pg.ClientBase) {
  const { rows } = await client.query<{ name: string }>(
    "select tablename as name from pg_tables where schemaname = 'public' order by 1",
  )
  return rows.map((row) => row.name)
}

test('the migrations make the tables, and a second run skips the file already applied', async (t) => {
  const client = await emptyDatabase(t)
  assert.deepEqual(await migrate(client), ['0001_init.sql'])
  assert.deepEqual(await tables(client), ['messages', 'reports', 'schema_migrations', 'users'])
  // Running 0001_init.sql again would fail on "relation already exists".
  assert.deepEqual(await migrate(client), [])
  const { rows } = await client.query('select name from schema_migrations')
  assert.deepEqual(rows, [{ name: '0001_init.sql' }])
})

test('files run in name order, and only the new ones run', async (t) => {
  const client = await emptyDatabase(t)
  const dir = folder(t, {
    '0002_b.sql': 'alter table a add column b int;',
    '0001_a.sql': 'create table a (id int);',
    'notes.txt': 'not a migration',
  })
  assert.deepEqual(await migrate(client, dir), ['0001_a.sql', '0002_b.sql'])
  writeFileSync(new URL('0003_c.sql', dir), 'create table c (id int);')
  assert.deepEqual(await migrate(client, dir), ['0003_c.sql'])
  assert.deepEqual(await tables(client), ['a', 'c', 'schema_migrations'])
})

test('a file that fails leaves nothing behind and is not recorded, so it runs again', async (t) => {
  const client = await emptyDatabase(t)
  const dir = folder(t, {
    '0001_ok.sql': 'create table ok (id int);',
    '0002_bad.sql': 'create table half (id int); select 1 / 0;',
  })
  await assert.rejects(migrate(client, dir), /Migration 0002_bad\.sql failed: division by zero/)
  assert.deepEqual(await tables(client), ['ok', 'schema_migrations'])
  const { rows } = await client.query('select name from schema_migrations')
  assert.deepEqual(rows, [{ name: '0001_ok.sql' }])
  writeFileSync(new URL('0002_bad.sql', dir), 'create table half (id int);')
  assert.deepEqual(await migrate(client, dir), ['0002_bad.sql'])
})

test('a .sql file not named NNNN_words.sql stops the run, rather than never running', async (t) => {
  const client = await emptyDatabase(t)
  for (const name of ['0002_add-index.sql', '002_x.sql', '0002_X.SQL']) {
    const dir = folder(t, { '0001_a.sql': 'create table a (id int);', [name]: 'select 1;' })
    await assert.rejects(migrate(client, dir), {
      message: `Migration file ${name} isn't named NNNN_words.sql (4 digits, _, then letters, digits or _)`,
    })
  }
  assert.deepEqual(await tables(client), [])
})
