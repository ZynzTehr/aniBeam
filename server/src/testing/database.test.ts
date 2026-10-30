import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import pg from 'pg'
import { testDatabase, type TestDatabase } from './database.ts'

let db: TestDatabase
before(async () => {
  db = await testDatabase()
})
after(() => db?.close())

test('the database answers select 1', async () => {
  const { rows } = await db.pool.query('select 1 as one')
  assert.deepEqual(rows, [{ one: 1 }])
})

test('server_version starts with 18', async () => {
  const { rows } = await db.pool.query('show server_version')
  assert.match(rows[0].server_version, /^18\./)
})

test('a test file gets a database of its own, named for its process, that no other sees', async () => {
  const { rows } = await db.pool.query('select current_database() as name')
  assert.equal(rows[0].name, `test_${process.pid}_1`)
  // A table made here reaches neither the template nor the next database copied from it.
  await db.pool.query('create table mine (id int)')
  const other = await testDatabase()
  try {
    const { rows } = await other.pool.query(
      "select count(*)::int as tables from pg_tables where tablename = 'mine'",
    )
    assert.deepEqual(rows, [{ tables: 0 }])
  } finally {
    await other.close()
  }
})

test("the tests' Postgres asks for its run's password, so no other program on this Mac gets in", async () => {
  // Its superuser could run commands as you (COPY ... TO PROGRAM), so a guess must not do.
  const url = new URL(db.url)
  assert.ok(url.password.length >= 32, 'the address carries a long password')
  url.password = 'guess'
  const client = new pg.Client({ connectionString: url.href })
  await assert.rejects(client.connect(), { code: '28P01' })
})
