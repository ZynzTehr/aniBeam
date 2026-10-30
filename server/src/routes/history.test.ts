import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { buildApp } from '../app.ts'
import { testDatabase, type TestDatabase } from '../testing/database.ts'

let db: TestDatabase
let app: ReturnType<typeof buildApp>
/** The users posting: aki's id, then rei's. */
let aki: number
let rei: number

before(async () => {
  db = await testDatabase()
  app = buildApp({ pool: db.pool })
  const { rows } = await db.pool.query<{ id: number }>(
    "insert into users (auth_uid, handle) values ('uid-aki-secret', 'aki'), ('uid-rei-secret', 'rei') returning id::int",
  )
  ;[aki, rei] = rows.map((row) => row.id)
})
after(async () => {
  await app?.close()
  await db?.close()
})

/** Posts `count` messages to a room, a second apart, oldest first, and returns their ids. */
async function post(room: string, count: number, user = aki) {
  const { rows } = await db.pool.query<{ id: number }>(
    `insert into messages (room_key, user_id, body, created_at)
     select $1, $2, 'message ' || n, timestamptz '2026-10-29 12:00:00Z' + n * interval '1 second'
     from generate_series(1, $3::int) n returning id::int`,
    [room, user, count],
  )
  return rows.map((row) => row.id)
}

/** Asks for a room's history at this address, and checks it answered with a page. */
async function page(url: string) {
  const response = await app.inject({ method: 'GET', url })
  assert.equal(response.statusCode, 200, response.body)
  return response.json<{ messages: { id: number }[]; nextBefore: number | null }>()
}

/** The ids of a page's messages. */
const ids = (body: { messages: { id: number }[] }) => body.messages.map((message) => message.id)

test('120 messages, 10 of them inside one millisecond, come back as 3 pages, newest first, none twice and none skipped', async () => {
  const room = 'anime:154587:ep:5'
  // The 66th to the 75th share one millisecond, a microsecond apart, across the first page's end.
  const { rows } = await db.pool.query<{ id: number }>(
    `insert into messages (room_key, user_id, body, created_at)
     select $1, $2, 'message ' || n, timestamptz '2026-10-29 12:00:00.123Z' + case
       when n between 66 and 75 then interval '66 seconds' + (n - 66) * interval '1 microsecond'
       else n * interval '1 second' end
     from generate_series(1, 120) n returning id::int`,
    [room, aki],
  )
  const posted = rows.map((row) => row.id)
  const { rows: times } = await db.pool.query(
    `select count(distinct date_trunc('milliseconds', created_at))::int as milliseconds,
       count(distinct created_at)::int as times from messages where id = any ($1)`,
    [posted.slice(65, 75)],
  )
  assert.deepEqual(times, [{ milliseconds: 1, times: 10 }])

  const first = await page(`/rooms/${room}/messages`)
  const second = await page(`/rooms/${room}/messages?before=${first.nextBefore}`)
  const third = await page(`/rooms/${room}/messages?before=${second.nextBefore}`)
  assert.deepEqual(
    [first, second, third].map((body) => body.messages.length),
    [50, 50, 20],
  )
  assert.deepEqual([...ids(first), ...ids(second), ...ids(third)], posted.toReversed())
  assert.equal(first.nextBefore, posted[70])
  assert.equal(second.nextBefore, posted[20])
  assert.equal(third.nextBefore, null)
})

test('a message carries its id, room, handle, body, spoiler and time, and never a user id or the sign-in uid', async () => {
  const room = 'anime:1:all'
  const { rows } = await db.pool.query<{ id: number; created_at: Date }>(
    `insert into messages (room_key, user_id, body, spoiler) values ($1, $2, 'he lives', true)
     returning id::int, created_at`,
    [room, rei],
  )
  const response = await app.inject({ method: 'GET', url: `/rooms/${room}/messages` })
  assert.deepEqual(response.json(), {
    messages: [
      {
        id: rows[0].id,
        roomKey: room,
        handle: 'rei',
        body: 'he lives',
        spoiler: true,
        createdAt: rows[0].created_at.toISOString(),
      },
    ],
    nextBefore: null,
  })
  assert.doesNotMatch(response.body, /auth_?uid|user_?id|uid-rei-secret/i)
})

test('hidden messages are left out, and a page still holds 50 shown ones', async () => {
  const room = 'anime:2:ep:1'
  const posted = await post(room, 55)
  const hidden = [posted[0], posted[10], posted[20], posted[30], posted[54]]
  await db.pool.query('update messages set hidden_at = now() where id = any ($1)', [hidden])
  const body = await page(`/rooms/${room}/messages`)
  assert.deepEqual(ids(body), posted.filter((id) => !hidden.includes(id)).toReversed())
  assert.equal(body.nextBefore, null)
})

test("another room's messages are left out", async () => {
  const mine = await post('anime:3:ep:1', 2)
  await post('anime:3:ep:2', 2, rei)
  assert.deepEqual(ids(await page('/rooms/anime:3:ep:1/messages')), mine.toReversed())
})

test('an empty room has no messages and no older page', async () => {
  assert.deepEqual(await page('/rooms/anime:4:all/messages'), { messages: [], nextBefore: null })
})

test('exactly 50 messages make one page, with no older page', async () => {
  const posted = await post('anime:5:all', 50)
  const body = await page('/rooms/anime:5:all/messages')
  assert.deepEqual(ids(body), posted.toReversed())
  assert.equal(body.nextBefore, null)
})

test('before the smallest id there is nothing, and before a larger id than any there is the newest page', async () => {
  const posted = await post('anime:6:all', 3)
  assert.deepEqual(await page(`/rooms/anime:6:all/messages?before=${posted[0]}`), {
    messages: [],
    nextBefore: null,
  })
  assert.deepEqual(
    ids(await page(`/rooms/anime:6:all/messages?before=${Number.MAX_SAFE_INTEGER}`)),
    posted.toReversed(),
  )
})

test('a bad room key answers 400 invalid', async () => {
  for (const key of [
    'anime:0:all',
    'anime:1:ep:0',
    'anime:01:all',
    'Anime:1:all',
    'anime:1:all%0A',
    'anime:1:all:x',
    'room',
    // Fastify refuses these itself, before the route: a bad %-escape, and a key over 100
    // characters.
    'anime:%ZZ:all',
    'anime:%',
    `anime:1:ep:${'1'.repeat(100)}`,
  ]) {
    const response = await app.inject({ method: 'GET', url: `/rooms/${key}/messages` })
    assert.equal(response.statusCode, 400, key)
    assert.deepEqual(response.json(), { error: 'invalid' }, key)
  }
})

test('a cursor that is not a message id answers 400 invalid', async () => {
  for (const before of [
    'abc',
    '',
    '0',
    '-1',
    '01',
    '1.5',
    '1e3',
    '%201',
    '99999999999999999999',
    '9007199254740992',
    '1&before=2',
  ]) {
    const response = await app.inject({
      method: 'GET',
      url: `/rooms/anime:1:all/messages?before=${before}`,
    })
    assert.equal(response.statusCode, 400, before)
    assert.deepEqual(response.json(), { error: 'invalid' }, before)
  }
})
