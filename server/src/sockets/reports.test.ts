import assert from 'node:assert/strict'
import { after, before, test, type TestContext } from 'node:test'
import pg from 'pg'
import type { Socket } from 'socket.io-client'
import { buildApp } from '../app.ts'
import { BadToken, type Verify } from '../auth/verify.ts'
import type { Hidden } from '../moderation/reports.ts'
import { testDatabase, type TestDatabase } from '../testing/database.ts'
import {
  ask,
  client,
  connected,
  hearing,
  listen,
  next,
  ORIGIN,
  WAIT,
  within,
} from '../testing/sockets.ts'
import type { ChatMessage } from './messages.ts'
import type { ChatSocket } from './sockets.ts'

// message:report, from clients connected as a browser's would be, recording to a database of
// this file's own.

const ROOM = 'anime:154587:ep:5'
const OTHER_ROOM = 'anime:154587:ep:6'

/**
 * The tests' sign-ins: aki, rei, kiri, hoshi, mio, sora, yuki, ren, nao and sumi have handles,
 * and new has signed in but has none yet. mio, yuki, ren, nao and sumi are banned by the tests
 * that need it.
 */
const UIDS: Record<string, string> = {
  'token-aki': 'uid-aki',
  'token-rei': 'uid-rei',
  'token-kiri': 'uid-kiri',
  'token-hoshi': 'uid-hoshi',
  'token-mio': 'uid-mio',
  'token-sora': 'uid-sora',
  'token-yuki': 'uid-yuki',
  'token-ren': 'uid-ren',
  'token-nao': 'uid-nao',
  'token-sumi': 'uid-sumi',
  'token-new': 'uid-new',
}
const verify: Verify = async (token) => {
  const uid = UIDS[token]
  if (uid === undefined) throw new BadToken('unknown test token')
  return { uid }
}

let db: TestDatabase
before(async () => {
  db = await testDatabase()
  await db.pool.query(
    `insert into users (auth_uid, handle) values ('uid-aki', 'aki'), ('uid-rei', 'rei'),
       ('uid-kiri', 'kiri'), ('uid-hoshi', 'hoshi'), ('uid-mio', 'mio'), ('uid-sora', 'sora'),
       ('uid-yuki', 'yuki'), ('uid-ren', 'ren'), ('uid-nao', 'nao'), ('uid-sumi', 'sumi')`,
  )
})
after(() => db?.close())

type App = ReturnType<typeof buildApp>

/** A listening app on the file's database, and its address. */
async function server(t: TestContext, options: Parameters<typeof buildApp>[0] = {}) {
  const app = buildApp({ corsOrigins: [ORIGIN], pool: db.pool, verify, ...options })
  return { app, url: await listen(t, app) }
}

/**
 * A client signed in with `token`, or signed out without one, connected and in `rooms`, with the
 * server's side of its socket.
 */
async function member(t: TestContext, app: App, url: string, token?: string, rooms = [ROOM]) {
  const arrived = next<ChatSocket>(app.io, 'connection')
  const socket = client(t, url, token === undefined ? {} : { auth: { token } })
  await within(connected(socket), 'connected')
  const server = await arrived
  for (const roomKey of rooms)
    assert.deepEqual(await ask(socket, 'join', { roomKey }), { ok: true }, roomKey)
  return { socket, server }
}

/** A new message of the user `uid`'s in `roomKey`, saved, and its id. */
async function posted(body: string, uid = 'uid-aki', roomKey = ROOM) {
  const { rows } = await db.pool.query<{ id: string }>(
    `insert into messages (room_key, user_id, body)
       select $1, id, $2 from users where auth_uid = $3 returning id`,
    [roomKey, body, uid],
  )
  return Number(rows[0].id)
}

/** The message's reports, and whether it is hidden. */
async function state(id: number) {
  const { rows } = await db.pool.query<{ hidden: boolean; reports: number }>(
    `select hidden_at is not null as hidden,
       (select count(*)::int from reports where message_id = $1) as reports
     from messages where id = $1`,
    [id],
  )
  return rows[0]
}

/**
 * The pid of a query waiting on a row lock in this file's database, once one is: the one of the
 * connection whose pid is `pid` if given, or any.
 */
async function lockWaiter(pid?: number) {
  const until = performance.now() + WAIT
  while (performance.now() < until) {
    const { rows } = await db.pool.query<{ pid: number }>(
      `select pid from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'
         and ($1::int is null or pid = $1)`,
      [pid ?? null],
    )
    if (rows.length > 0) return rows[0].pid
  }
  throw new Error(`no query waiting on a lock within ${WAIT} ms`)
}

const reportOf = (socket: Socket, id: number, reason = 'spam') =>
  ask(socket, 'message:report', { id, reason })

/**
 * Starts keeping the message:hidden events `socket` gets, and gives a function that resolves
 * with them, up to a mark the server sends after them (hearing()).
 */
function hiddenTo({ socket, server }: { socket: Socket; server: ChatSocket }) {
  const got: Hidden[] = []
  socket.on('message:hidden', (hidden: Hidden) => got.push(hidden))
  const heard = hearing(socket, server)
  return async () => {
    await heard()
    return got
  }
}

test('the same reporter twice counts once, and two reports leave the message showing', async (t) => {
  const { app, url } = await server(t)
  const rei = await member(t, app, url, 'token-rei')
  const kiri = await member(t, app, url, 'token-kiri')
  const id = await posted('reported twice')
  const toRei = hiddenTo(rei)
  assert.deepEqual(await reportOf(rei.socket, id, 'other'), { ok: true })
  assert.deepEqual(await reportOf(rei.socket, id, 'abuse'), { ok: true })
  // Another of rei's sockets is rei too.
  const again = await member(t, app, url, 'token-rei', [])
  assert.deepEqual(await reportOf(again.socket, id, 'spam'), { ok: true })
  assert.deepEqual(await state(id), { hidden: false, reports: 1 })
  // The first report's reason stays.
  const { rows } = await db.pool.query('select reason from reports where message_id = $1', [id])
  assert.deepEqual(rows, [{ reason: 'other' }])
  assert.deepEqual(await reportOf(kiri.socket, id), { ok: true })
  assert.deepEqual(await state(id), { hidden: false, reports: 2 })
  assert.deepEqual(await toRei(), [])
  const response = await app.inject({ method: 'GET', url: `/rooms/${ROOM}/messages` })
  const { messages } = response.json<{ messages: ChatMessage[] }>()
  assert.ok(messages.some((message) => message.id === id))
})

test('3 reporters at once hide the message: each socket in the room, the reporters too, gets message:hidden once, and history leaves it out', async (t) => {
  const { app, url } = await server(t)
  const author = await member(t, app, url, 'token-aki')
  const reporters = [
    await member(t, app, url, 'token-rei'),
    await member(t, app, url, 'token-kiri'),
    await member(t, app, url, 'token-hoshi'),
  ]
  const reader = await member(t, app, url)
  const elsewhere = await member(t, app, url, 'token-sora', [OTHER_ROOM])
  const shown = await posted('the one to hide')
  const id = await posted('reported, then hidden')
  const inRoom = [author, ...reporters, reader]
  const heard = inRoom.map(hiddenTo)
  const heardElsewhere = hearing(elsewhere.socket, elsewhere.server)
  // spoiler, abuse and spam, each a reason the table takes.
  const answers = await Promise.all(
    reporters.map(({ socket }, i) => reportOf(socket, id, ['spoiler', 'abuse', 'spam'][i])),
  )
  assert.deepEqual(answers, [{ ok: true }, { ok: true }, { ok: true }])
  for (const [i, got] of (await Promise.all(heard.map((one) => one()))).entries())
    assert.deepEqual(got, [{ id, roomKey: ROOM }], `socket ${i}`)
  assert.deepEqual(await heardElsewhere(), [])
  assert.deepEqual(await state(id), { hidden: true, reports: 3 })
  const response = await app.inject({ method: 'GET', url: `/rooms/${ROOM}/messages` })
  const ids = response.json<{ messages: ChatMessage[] }>().messages.map((message) => message.id)
  assert.equal(ids.includes(id), false)
  assert.ok(ids.includes(shown))
  // Hidden, it is not-found to a 4th report and to its reporters, and the room is told nothing
  // more.
  const more = inRoom.map(hiddenTo)
  assert.deepEqual(await reportOf(elsewhere.socket, id), { error: 'not-found' })
  assert.deepEqual(await reportOf(reporters[0].socket, id), { error: 'not-found' })
  for (const got of await Promise.all(more.map((one) => one()))) assert.deepEqual(got, [])
  assert.deepEqual(await state(id), { hidden: true, reports: 3 })
})

test('a bad payload answers invalid, a signed-out socket sign-in-required, and nothing is recorded', async (t) => {
  const { app, url } = await server(t)
  const rei = await member(t, app, url, 'token-rei')
  const reader = await member(t, app, url)
  const id = await posted('not reported')
  for (const args of [
    [{ id: 0, reason: 'spam' }],
    [{ id: 1.5, reason: 'spam' }],
    [{ id: String(id), reason: 'spam' }],
    [{ id, reason: 'rude' }],
    [{ id }],
    [{ id, reason: 'spam', handle: 'kiri' }],
    [id],
    [],
    [{ id, reason: 'spam' }, 'more'],
  ])
    assert.deepEqual(
      await ask(rei.socket, 'message:report', ...args),
      { error: 'invalid' },
      JSON.stringify(args),
    )
  // Signed out, a socket reads but doesn't report; the payload is checked first.
  assert.deepEqual(await reportOf(reader.socket, id), { error: 'sign-in-required' })
  assert.deepEqual(await reportOf(reader.socket, id, 'rude'), { error: 'invalid' })
  assert.deepEqual(await state(id), { hidden: false, reports: 0 })
})

test("a user's own message answers cannot-report-own, one with no handle handle-required, a banned one banned, and a missing message not-found", async (t) => {
  const { app, url } = await server(t)
  const aki = await member(t, app, url, 'token-aki')
  const newcomer = await member(t, app, url, 'token-new')
  const mio = await member(t, app, url, 'token-mio')
  const id = await posted('my own')
  assert.deepEqual(await reportOf(aki.socket, id), { error: 'cannot-report-own' })
  assert.deepEqual(await reportOf(newcomer.socket, id), { error: 'handle-required' })
  await db.pool.query("UPDATE users SET banned_at = now() WHERE lower(handle) = lower('mio')")
  assert.deepEqual(await reportOf(mio.socket, id), { error: 'banned' })
  assert.deepEqual(await state(id), { hidden: false, reports: 0 })
  const { rows } = await db.pool.query<{ id: string }>('select max(id) as id from messages')
  assert.deepEqual(await reportOf(aki.socket, Number(rows[0].id) + 1000), { error: 'not-found' })
})

test('an 11th report within a minute answers rate-limited with the wait, and is not recorded', async (t) => {
  const clock = { now: 0 }
  const { app, url } = await server(t, { now: () => clock.now })
  const kiri = await member(t, app, url, 'token-kiri')
  const hoshi = await member(t, app, url, 'token-hoshi')
  const ids = []
  for (let i = 0; i < 11; i++) ids.push(await posted(`limited ${i}`))
  for (const [i, id] of ids.slice(0, 10).entries()) {
    clock.now = i * 1_000
    assert.deepEqual(await reportOf(kiri.socket, id), { ok: true }, String(i))
  }
  // The wait is until the first, made at 0, is a minute old.
  clock.now = 30_000
  assert.deepEqual(await reportOf(kiri.socket, ids[10]), {
    error: 'rate-limited',
    retryAfterMs: 30_000,
  })
  assert.deepEqual(await state(ids[10]), { hidden: false, reports: 0 })
  // hoshi's reports are hoshi's own.
  assert.deepEqual(await reportOf(hoshi.socket, ids[10]), { ok: true })
  clock.now = 60_000
  assert.deepEqual(await reportOf(kiri.socket, ids[10]), { ok: true })
  assert.deepEqual(await state(ids[10]), { hidden: false, reports: 2 })
})

test('a report whose database connection ends mid-transaction answers server-error, and the server goes on', async (t) => {
  // A pool of the app's own, so that its connections can be counted.
  const pool = new pg.Pool({ connectionString: db.url })
  t.after(() => pool.end())
  const { app, url } = await server(t, { pool })
  const rei = await member(t, app, url, 'token-rei')
  const id = await posted('locked while reported')
  // Another connection holds the message's row, so that the report waits in its transaction.
  const holder = await db.pool.connect()
  await holder.query('begin')
  await holder.query('select id from messages where id = $1 for update', [id])
  const answer = reportOf(rei.socket, id)
  // Postgres ends the report's connection, as a restart or a host cutting connections would.
  await db.pool.query('select pg_terminate_backend($1)', [await lockWaiter()])
  assert.deepEqual(await answer, { error: 'server-error' })
  await holder.query('rollback')
  holder.release()
  // The broken connection was dropped, not kept in the pool, nor lost to it.
  assert.equal(pool.totalCount, 0)
  assert.deepEqual(await reportOf(rei.socket, id), { ok: true })
  assert.deepEqual(await state(id), { hidden: false, reports: 1 })
})

test('a ban made while a report waits on its message waits for the report, so it is the ban that comes after', async (t) => {
  const { app, url } = await server(t)
  const yuki = await member(t, app, url, 'token-yuki')
  const id = await posted('reported as the ban is made')
  const holder = await db.pool.connect()
  t.after(() => holder.release())
  await holder.query('begin')
  await holder.query('select id from messages where id = $1 for update', [id])
  const answer = reportOf(yuki.socket, id)
  await lockWaiter()
  // The ban, on a connection of its own, while the report has read yuki's row and waits.
  const banner = await db.pool.connect()
  t.after(() => banner.release())
  const { rows } = await banner.query<{ pid: number }>('select pg_backend_pid() as pid')
  const banned = banner.query(
    "UPDATE users SET banned_at = now() WHERE lower(handle) = lower('yuki')",
  )
  const first = await Promise.race([
    banned.then(() => 'the ban'),
    lockWaiter(rows[0].pid).then(() => 'the report'),
  ])
  assert.equal(first, 'the report')
  await holder.query('rollback')
  assert.deepEqual(await answer, { ok: true })
  await banned
  assert.deepEqual(await state(id), { hidden: false, reports: 1 })
  assert.deepEqual(await reportOf(yuki.socket, await posted('after the ban')), { error: 'banned' })
})

test("reports by users banned since don't count: a message they hid, shown again, stays shown at the next report", async (t) => {
  const { app, url } = await server(t)
  const trolls = [
    await member(t, app, url, 'token-ren'),
    await member(t, app, url, 'token-nao'),
    await member(t, app, url, 'token-sumi'),
  ]
  const kiri = await member(t, app, url, 'token-kiri')
  const id = await posted('an honest message')
  for (const { socket } of trolls) assert.deepEqual(await reportOf(socket, id), { ok: true })
  assert.deepEqual(await state(id), { hidden: true, reports: 3 })
  // The three are banned, and the message shown again, as the README says.
  await db.pool.query("UPDATE users SET banned_at = now() WHERE handle in ('ren', 'nao', 'sumi')")
  await db.pool.query('UPDATE messages SET hidden_at = NULL WHERE id = $1', [id])
  const toKiri = hiddenTo(kiri)
  assert.deepEqual(await reportOf(kiri.socket, id), { ok: true })
  assert.deepEqual(await state(id), { hidden: false, reports: 4 })
  assert.deepEqual(await toKiri(), [])
})

test('message:hidden goes to the room only once the hide has committed', async (t) => {
  // The database through a pool of the test's own, whose connections stop at a COMMIT while the
  // test holds them: a room told before the commit would be told of a hide that could still
  // fail, and a history read then would still have the message.
  const pool = new pg.Pool({ connectionString: db.url })
  t.after(() => pool.end())
  let holding: { reached: () => void; go: Promise<void> } | undefined
  const held = new WeakSet<pg.PoolClient>()
  pool.on('acquire', (client) => {
    if (held.has(client)) return
    held.add(client)
    const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>
    ;(client as { query: unknown }).query = async (...args: unknown[]) => {
      if (args[0] === 'commit' && holding) {
        holding.reached()
        await holding.go
      }
      return query(...args)
    }
  })
  const { app, url } = await server(t, { pool })
  const reporters = [
    await member(t, app, url, 'token-rei'),
    await member(t, app, url, 'token-kiri'),
    await member(t, app, url, 'token-hoshi'),
  ]
  const reader = await member(t, app, url)
  const id = await posted('hidden once committed')
  for (const { socket } of reporters.slice(0, 2))
    assert.deepEqual(await reportOf(socket, id), { ok: true })
  // The third report, which hides the message, stops at its COMMIT.
  let reached = () => {}
  const atCommit = new Promise<void>((resolve) => (reached = resolve))
  let go = () => {}
  holding = { reached, go: new Promise<void>((resolve) => (go = resolve)) }
  const heard = hearing(reader.socket, reader.server)
  const answer = reportOf(reporters[2].socket, id)
  await within(atCommit, 'no commit')
  let hidden
  try {
    // Nothing has gone to the room while the hide waits to commit.
    assert.deepEqual(await heard(), [])
    hidden = next(reader.socket, 'message:hidden')
  } finally {
    holding = undefined
    go()
  }
  assert.deepEqual(await hidden, { id, roomKey: ROOM })
  assert.deepEqual(await answer, { ok: true })
  assert.deepEqual(await state(id), { hidden: true, reports: 3 })
})

test('an app without a database has no message:report', async (t) => {
  const app = buildApp({ corsOrigins: [ORIGIN], verify })
  const url = await listen(t, app)
  const rei = await member(t, app, url, 'token-rei')
  assert.equal(rei.server.listeners('message:report').length, 0)
})
