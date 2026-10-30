import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
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
