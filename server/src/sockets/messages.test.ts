import assert from 'node:assert/strict'
import { after, before, test, type TestContext } from 'node:test'
import pg from 'pg'
import { buildApp } from '../app.ts'
import { BadToken, type Verify } from '../auth/verify.ts'
import { testDatabase, type TestDatabase } from '../testing/database.ts'
import {
  ask,
  client,
  connected,
  hearing,
  listen,
  next,
  ORIGIN,
  within,
} from '../testing/sockets.ts'
import type { ChatMessage } from './messages.ts'
import type { ChatSocket } from './sockets.ts'

// message:send, from clients connected as a browser's would be, saving to a database of this
// file's own.

const ROOM = 'anime:154587:ep:5'
const OTHER_ROOM = 'anime:154587:ep:6'

/** The tests' sign-ins: aki, rei and kiri have handles, and new has signed in but has none yet. */
const UIDS: Record<string, string> = {
  'token-aki': 'uid-aki',
  'token-rei': 'uid-rei',
  'token-kiri': 'uid-kiri',
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
    "insert into users (auth_uid, handle) values ('uid-aki', 'Aki'), ('uid-rei', 'rei'), ('uid-kiri', 'kiri')",
  )
})
after(() => db?.close())

type App = ReturnType<typeof buildApp>

/** A listening app on `pool` (the file's database unless given), and its address. */
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

/** How many saved messages have this body. */
async function saved(body: string) {
  const { rows } = await db.pool.query<{ count: number }>(
    'select count(*)::int as count from messages where body = $1',
    [body],
  )
  return rows[0].count
}

test("B gets A's message within 1,000 ms, and A gets it once, through its ack alone", async (t) => {
  const { app, url } = await server(t)
  const a = await member(t, app, url, 'token-aki')
  const b = await member(t, app, url, 'token-rei')
  const elsewhere = await member(t, app, url, 'token-kiri', [OTHER_ROOM])
  const heardByA = hearing(a.socket, a.server)
  const heardElsewhere = hearing(elsewhere.socket, elsewhere.server)
  const arrived = next<ChatMessage>(b.socket, 'message:new')
  const sent = performance.now()
  const answer = await ask(a.socket, 'message:send', {
    roomKey: ROOM,
    body: 'Episode 5 was something',
    spoiler: false,
  })
  const message = await arrived
  const took = performance.now() - sent
  t.diagnostic(`B got it ${took.toFixed(1)} ms after A sent it`)
  assert.ok(took < 1000, `B got it after ${took} ms`)
  assert.deepEqual(answer, { ok: true, message })
  // A handle, from aki's row as it is written there, and never a user id or the sign-in's uid.
  assert.deepEqual(Object.keys(message).sort(), [
    'body',
    'createdAt',
    'handle',
    'id',
    'roomKey',
    'spoiler',
  ])
  assert.equal(message.handle, 'Aki')
  assert.equal(message.roomKey, ROOM)
  assert.equal(message.body, 'Episode 5 was something')
  assert.equal(message.spoiler, false)
  assert.ok(Number.isSafeInteger(message.id) && message.id > 0)
  assert.match(message.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  // A has no message:new of its own, and another room hears nothing.
  assert.deepEqual(await heardByA(), [])
  assert.deepEqual(await heardElsewhere(), [])
  assert.equal(await saved('Episode 5 was something'), 1)
})

test('the sender has its ack before the room is sent the message', async (t) => {
  const { app, url } = await server(t)
  const a = await member(t, app, url, 'token-aki')
  const b = await member(t, app, url, 'token-rei')
  // The packets as the server writes them: an ACK of Socket.IO's begins with 3, an event with 2.
  const written: string[] = []
  a.server.conn.on('packetCreate', (packet: { data?: unknown }) => {
    if (String(packet.data).startsWith('3')) written.push('ack to A')
  })
  b.server.conn.on('packetCreate', (packet: { data?: unknown }) => {
    if (String(packet.data).startsWith('2["message:new"')) written.push('message:new to B')
  })
  const arrived = next(b.socket, 'message:new')
  await ask(a.socket, 'message:send', { roomKey: ROOM, body: 'ack first', spoiler: true })
  await arrived
  assert.deepEqual(written, ['ack to A', 'message:new to B'])
})

test('history then holds the message as the ack gave it, and a body of HTML is kept as text', async (t) => {
  const { app, url } = await server(t)
  const a = await member(t, app, url, 'token-aki', [OTHER_ROOM])
  const body = '<img src=x onerror=alert(1)>'
  const answer = (await ask(a.socket, 'message:send', {
    roomKey: OTHER_ROOM,
    body,
    spoiler: true,
  })) as { message: ChatMessage }
  assert.equal(answer.message.body, body)
  const response = await app.inject({ method: 'GET', url: `/rooms/${OTHER_ROOM}/messages` })
  const { messages } = response.json<{ messages: ChatMessage[] }>()
  assert.deepEqual(messages[0], answer.message)
  assert.equal(messages[0].body, body)
})

test('a body of 501 code points, or of spaces or characters that show nothing alone, or any other bad payload answers invalid, and nothing is saved', async (t) => {
  const { app, url } = await server(t)
  const a = await member(t, app, url, 'token-aki')
  const b = await member(t, app, url, 'token-rei')
  const heardByB = hearing(b.socket, b.server)
  const emoji = '\u{1F600}'
  for (const args of [
    [{ roomKey: ROOM, body: emoji.repeat(501), spoiler: false }],
    [{ roomKey: ROOM, body: '    ', spoiler: false }],
    // Characters that show nothing, which trimming leaves: a zero-width space, a Hangul filler.
    [{ roomKey: ROOM, body: '\u200B', spoiler: false }],
    [{ roomKey: ROOM, body: '\u3164', spoiler: false }],
    [{ roomKey: ROOM, body: 'no spoiler' }],
    [{ roomKey: ROOM, body: 'a string spoiler', spoiler: 'false' }],
    // The handle comes from the sender's row: one in the payload is refused, as is a user id.
    [{ roomKey: ROOM, body: 'as rei', spoiler: false, handle: 'rei' }],
    [{ roomKey: ROOM, body: 'as rei', spoiler: false, uid: 'uid-rei' }],
    [{ roomKey: 'anime:0:all', body: 'bad room', spoiler: false }],
    ['just a string'],
    [],
    [{ roomKey: ROOM, body: 'and more', spoiler: false }, 'more'],
  ])
    assert.deepEqual(
      await ask(a.socket, 'message:send', ...args),
      { error: 'invalid' },
      JSON.stringify(args),
    )
  for (const body of [
    emoji.repeat(501),
    '\u200B',
    '\u3164',
    'no spoiler',
    'a string spoiler',
    'as rei',
    'and more',
  ])
    assert.equal(await saved(body), 0, body)
  assert.deepEqual(await heardByB(), [])
  // 500 emoji fit, as the database counts them, and the body is saved trimmed.
  const full = (await ask(a.socket, 'message:send', {
    roomKey: ROOM,
    body: ` ${emoji.repeat(500)}\n`,
    spoiler: false,
  })) as { message: ChatMessage }
  assert.equal(full.message.body, emoji.repeat(500))
  assert.equal(await saved(emoji.repeat(500)), 1)
})

test('a signed-out socket reads the room live, but its send answers sign-in-required', async (t) => {
  const { app, url } = await server(t)
  const a = await member(t, app, url, 'token-aki')
  const reader = await member(t, app, url)
  const heardByA = hearing(a.socket, a.server)
  const heardLive = next<ChatMessage>(reader.socket, 'message:new')
  await ask(a.socket, 'message:send', { roomKey: ROOM, body: 'read me', spoiler: false })
  assert.equal((await heardLive).body, 'read me')
  const send = { roomKey: ROOM, body: 'signed out', spoiler: false }
  assert.deepEqual(await ask(reader.socket, 'message:send', send), { error: 'sign-in-required' })
  // The payload is checked first.
  assert.deepEqual(await ask(reader.socket, 'message:send', { ...send, spoiler: 'no' }), {
    error: 'invalid',
  })
  assert.equal(await saved('signed out'), 0)
  assert.deepEqual(await heardByA(), [])
})

test("a send to a room the socket isn't in answers not-joined, and after a leave too", async (t) => {
  const { app, url } = await server(t)
  const a = await member(t, app, url, 'token-aki', [])
  const b = await member(t, app, url, 'token-rei')
  const heardByB = hearing(b.socket, b.server)
  const send = { roomKey: ROOM, body: 'not in the room', spoiler: false }
  assert.deepEqual(await ask(a.socket, 'message:send', send), { error: 'not-joined' })
  assert.deepEqual(await ask(a.socket, 'join', { roomKey: ROOM }), { ok: true })
  assert.deepEqual(await ask(a.socket, 'leave', { roomKey: ROOM }), { ok: true })
  assert.deepEqual(await ask(a.socket, 'message:send', send), { error: 'not-joined' })
  assert.equal(await saved('not in the room'), 0)
  assert.deepEqual(await heardByB(), [])
})

test('a user with no handle yet gets handle-required, and can send once they pick one', async (t) => {
  const { app, url } = await server(t)
  const newcomer = await member(t, app, url, 'token-new')
  const b = await member(t, app, url, 'token-rei')
  const heardByB = hearing(b.socket, b.server)
  const send = { roomKey: ROOM, body: 'first post', spoiler: false }
  assert.deepEqual(await ask(newcomer.socket, 'message:send', send), { error: 'handle-required' })
  assert.equal(await saved('first post'), 0)
  assert.deepEqual(await heardByB(), [])
  const picked = await app.inject({
    method: 'POST',
    url: '/me/handle',
    headers: { authorization: 'Bearer token-new' },
    payload: { handle: 'newbie' },
  })
  assert.equal(picked.statusCode, 201, picked.body)
  const answer = (await ask(newcomer.socket, 'message:send', send)) as { message: ChatMessage }
  assert.equal(answer.message.handle, 'newbie')
})

test('when the database fails, the ack is server-error, the room gets nothing, and the log keeps neither the uid nor the body', async (t) => {
  let log = ''
  // Port 1, where no Postgres is: every query fails to connect.
  const down = new pg.Pool({ connectionString: 'postgres://anibeam@127.0.0.1:1/anibeam' })
  t.after(() => down.end())
  const { app, url } = await server(t, {
    pool: down,
    logger: { stream: { write: (line) => void (log += line) } },
  })
  const a = await member(t, app, url, 'token-aki')
  const b = await member(t, app, url, 'token-rei')
  const heardByB = hearing(b.socket, b.server)
  assert.deepEqual(
    await ask(a.socket, 'message:send', { roomKey: ROOM, body: 'secret body', spoiler: false }),
    { error: 'server-error' },
  )
  assert.deepEqual(await heardByB(), [])
  assert.doesNotMatch(log, /uid-aki|secret body/)
  assert.match(log, /"msg":"A database query failed"/)
  assert.match(log, /"code":"ECONNREFUSED"/)
  // The socket is still open, and the server answers its next event.
  assert.deepEqual(await ask(a.socket, 'join', { roomKey: OTHER_ROOM }), { ok: true })
})

test('an app without a database has no message:send, as it has no history', async (t) => {
  const app = buildApp({ corsOrigins: [ORIGIN], verify })
  const url = await listen(t, app)
  const a = await member(t, app, url, 'token-aki')
  assert.equal(a.server.listeners('message:send').length, 0)
})
