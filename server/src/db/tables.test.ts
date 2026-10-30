import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { testDatabase, type TestDatabase } from '../testing/database.ts'

// The rules the tables keep themselves (server/migrations/0001_init.sql), whatever the server
// sends them. A refusal names the constraint that refused, so each test checks it was that one.

let db: TestDatabase
before(async () => {
  db = await testDatabase()
})
after(() => db?.close())

let users = 0

/** Adds a user with this handle and returns its id. */
async function addUser(handle = `user${++users}`) {
  const { rows } = await db.pool.query<{ id: string }>(
    'insert into users (auth_uid, handle) values ($1, $2) returning id',
    [`uid-${handle}`, handle],
  )
  return rows[0].id
}

/** Posts a message and returns its id. */
async function addMessage(userId: string, body = 'hi') {
  const { rows } = await db.pool.query<{ id: string }>(
    "insert into messages (room_key, user_id, body) values ('anime:1:all', $1, $2) returning id",
    [userId, body],
  )
  return rows[0].id
}

test('a 501-character body is refused, and 500 characters fit, even as 500 emoji', async () => {
  const user = await addUser()
  await assert.rejects(addMessage(user, 'a'.repeat(501)), {
    code: '23514',
    constraint: 'messages_body_check',
  })
  await addMessage(user, 'a'.repeat(500))
  // Each emoji is two UTF-16 units in JavaScript, but one character to Postgres.
  await addMessage(user, '😀'.repeat(500))
  await assert.rejects(addMessage(user, '😀'.repeat(501)), { constraint: 'messages_body_check' })
})

test('an empty body is refused', async () => {
  await assert.rejects(addMessage(await addUser(), ''), {
    code: '23514',
    constraint: 'messages_body_check',
  })
})

test('a message must come from a user who exists', async () => {
  await assert.rejects(addMessage('999999'), { code: '23503', constraint: 'messages_user_id_fkey' })
})

test('Aki and aki clash', async () => {
  await addUser('Aki')
  await assert.rejects(addUser('aki'), { code: '23505', constraint: 'users_handle_lower_key' })
})

test('a handle is required', async () => {
  await assert.rejects(
    db.pool.query("insert into users (auth_uid, handle) values ('uid-none', null)"),
    { code: '23502', column: 'handle' },
  )
})

test('one sign-in has one account', async () => {
  await db.pool.query("insert into users (auth_uid, handle) values ('uid-same', 'first')")
  await assert.rejects(
    db.pool.query("insert into users (auth_uid, handle) values ('uid-same', 'second')"),
    { code: '23505', constraint: 'users_auth_uid_key' },
  )
})

test('a second report by the same person is refused', async () => {
  const message = await addMessage(await addUser())
  const reporter = await addUser()
  const report = () =>
    db.pool.query("insert into reports (message_id, reporter_id, reason) values ($1, $2, 'spam')", [
      message,
      reporter,
    ])
  await report()
  await assert.rejects(report(), {
    code: '23505',
    constraint: 'reports_message_id_reporter_id_key',
  })
  // Another person's report of the same message counts.
  await db.pool.query(
    "insert into reports (message_id, reporter_id, reason) values ($1, $2, 'spam')",
    [message, await addUser()],
  )
})

test("a report's reason is spoiler, abuse, spam or other", async () => {
  const message = await addMessage(await addUser())
  const reporter = await addUser()
  for (const reason of ['spoiler', 'abuse', 'spam', 'other'])
    await db.pool.query(
      'insert into reports (message_id, reporter_id, reason) values ($1, $2, $3)',
      [message, await addUser(), reason],
    )
  await assert.rejects(
    db.pool.query(
      "insert into reports (message_id, reporter_id, reason) values ($1, $2, 'boring')",
      [message, reporter],
    ),
    { code: '23514', constraint: 'reports_reason_check' },
  )
})

test('ids grow in the order rows are added, and a message starts shown and not a spoiler', async () => {
  const user = await addUser()
  const first = Number(await addMessage(user))
  const second = Number(await addMessage(user))
  assert.ok(second > first)
  const { rows } = await db.pool.query('select spoiler, hidden_at from messages where id = $1', [
    second,
  ])
  assert.deepEqual(rows, [{ spoiler: false, hidden_at: null }])
})
