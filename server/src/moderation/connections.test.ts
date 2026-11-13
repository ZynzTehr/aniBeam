import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { buildApp } from '../app.ts'
import { BadToken, type Verify } from '../auth/verify.ts'
import type { TrustProxy } from '../client-ip.ts'
import type { ChatSocket } from '../sockets/sockets.ts'
import { client, connected, listen, next, ORIGIN, within } from '../testing/sockets.ts'

// The connections per IP address, with a max of 2 so that the tests stay small. Every client
// here comes from 127.0.0.1, and those with a proxy trusted send X-Forwarded-For as one would.

const verify: Verify = async (token) => {
  if (token !== 'token-aki') throw new BadToken('unknown test token')
  return { uid: 'uid-aki' }
}

/** A raw connection, beneath a socket. */
type Connection = ChatSocket['conn']

/**
 * A listening app allowing 2 connections per IP, trusting `trustProxy`, and its address. A
 * connection past the max stays open for its refusal `refusalGraceMs`, a minute unless given, so
 * that a test which sees one close knows it wasn't the grace that closed it.
 */
async function server(
  t: TestContext,
  {
    trustProxy,
    refusalGraceMs = 60_000,
  }: { trustProxy?: TrustProxy; refusalGraceMs?: number } = {},
) {
  const app = buildApp({
    corsOrigins: [ORIGIN],
    maxConnectionsPerIp: 2,
    refusalGraceMs,
    trustProxy,
    verify,
  })
  return { app, url: await listen(t, app) }
}

type App = ReturnType<typeof buildApp>

/**
 * The server's next raw connection, and a promise of its close, kept from the moment it opens:
 * the server may close it before a test would start to wait.
 */
async function nextConnection(app: App) {
  const connection = await next<Connection>(app.io.engine, 'connection')
  const closed = new Promise<void>((resolve) => connection.once('close', () => resolve()))
  return { connection, closed: () => within(closed, 'no close') }
}

/**
 * Opens a client with `options`, and gives the client, the server's raw connection for it, a
 * wait for that connection's close, and whether it connected (true) or the code its
 * connect_error had.
 */
async function open(
  t: TestContext,
  app: App,
  url: string,
  options: Parameters<typeof client>[2] = {},
) {
  const opened = nextConnection(app)
  const socket = client(t, url, options)
  const outcome = await within(
    connected(socket).then(
      () => true as const,
      (err: Error) => err.message,
    ),
    'connect or connect_error',
  )
  return { socket, ...(await opened), outcome }
}

/**
 * A WebSocket to `url`'s Socket.IO, written by hand as a script would: it reads the server's
 * packets, sends only what a test tells it, and never closes on its own. It gives the packets
 * as they come, and a wait for the server to close it.
 */
function raw(t: TestContext, url: string) {
  const socket = new WebSocket(
    `${url.replace('http', 'ws')}/socket.io/?EIO=4&transport=websocket`,
    {
      headers: { origin: ORIGIN },
    },
  )
  t.after(() => socket.close())
  const packets: string[] = []
  socket.addEventListener('message', (event) => packets.push(String(event.data)))
  const closed = new Promise<void>((resolve) => socket.addEventListener('close', () => resolve()))
  // Whether the server took it (true), or refused it before it opened (false).
  const opened = new Promise<boolean>((resolve) => {
    socket.addEventListener('open', () => resolve(true))
    socket.addEventListener('error', () => resolve(false))
  })
  return {
    socket,
    packets,
    opened: () => within(opened, 'no open or error'),
    closed: () => within(closed, 'no close'),
  }
}

/** A polling request to `url`'s Socket.IO, as a script would send it, and its answer's text. */
async function poll(url: string, query: string, body?: string) {
  const response = await fetch(`${url}/socket.io/?EIO=4&transport=polling${query}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: ORIGIN },
    body,
  })
  assert.equal(response.status, 200, query)
  return response.text()
}

/** Closes `socket`, and resolves once the server has seen its connection close. */
async function close(socket: { close(): void }, connection: Connection) {
  const closed = next(connection, 'close')
  socket.close()
  await closed
}

test('the 3rd connection from one address gets too-many-connections', async (t) => {
  const { app, url } = await server(t)
  assert.equal((await open(t, app, url)).outcome, true)
  assert.equal((await open(t, app, url, { auth: { token: 'token-aki' } })).outcome, true)
  const third = await open(t, app, url, { auth: { token: 'token-aki' } })
  assert.equal(third.outcome, 'too-many-connections')
  // The connection closes, so the refusal doesn't hold a place either.
  await third.closed()
  assert.equal((await open(t, app, url)).outcome, 'too-many-connections')
})

test('over polling, the 3rd connection gets too-many-connections too', async (t) => {
  const { app, url } = await server(t)
  const polling = { transports: ['polling'] }
  assert.equal((await open(t, app, url, polling)).outcome, true)
  assert.equal((await open(t, app, url, polling)).outcome, true)
  assert.equal((await open(t, app, url, polling)).outcome, 'too-many-connections')
})

test('a place frees once a connection closes', async (t) => {
  const { app, url } = await server(t)
  const first = await open(t, app, url)
  await open(t, app, url)
  const refused = await open(t, app, url)
  assert.equal(refused.outcome, 'too-many-connections')
  await refused.closed()
  await close(first.socket, first.connection)
  assert.equal((await open(t, app, url)).outcome, true)
})

test('3 bad-token tries, once closed, still let good connections in', async (t) => {
  const { app, url } = await server(t)
  for (let tries = 1; tries <= 3; tries++) {
    const bad = await open(t, app, url, { auth: { token: 'token-nobody' } })
    assert.equal(bad.outcome, 'bad-token', `try ${tries}`)
    // Refused for its token, it never became a socket, and its client closed it.
    await bad.closed()
  }
  // Both places are free: the refused connections left no count behind.
  assert.equal((await open(t, app, url, { auth: { token: 'token-aki' } })).outcome, true)
  assert.equal((await open(t, app, url, { auth: { token: 'token-aki' } })).outcome, true)
})

test('a client that ignores the refusal is closed as soon as it has the code', async (t) => {
  const { app, url } = await server(t)
  await open(t, app, url)
  await open(t, app, url)
  const opened = nextConnection(app)
  const script = raw(t, url)
  const { closed } = await opened
  // Its CONNECT, once Engine.IO's open packet (0) has come, as a Socket.IO client's would be.
  await within(new Promise((resolve) => script.socket.addEventListener('message', resolve)), 'open')
  script.socket.send('40')
  await closed()
  await script.closed()
  assert.deepEqual(script.packets.slice(1), ['44{"message":"too-many-connections"}'])
  // Only the 2 connections in the count are left open.
  assert.equal(app.io.engine.clientsCount, 2)
})

test('a connection past the max that never asks to connect closes after the grace', async (t) => {
  const { app, url } = await server(t, { refusalGraceMs: 50 })
  await open(t, app, url)
  await open(t, app, url)
  const opened = nextConnection(app)
  const script = raw(t, url)
  await (await opened).closed()
  await script.closed()
  // The 2 within the max opened before it, and are open still: the grace is for those past it.
  assert.equal(app.io.engine.clientsCount, 2)
})

test('over polling, a connection past the max that never asks to connect closes after the grace', async (t) => {
  const { app, url } = await server(t, { refusalGraceMs: 50 })
  await open(t, app, url)
  await open(t, app, url)
  const opened = nextConnection(app)
  // The handshake alone: its answer is the one request, and nothing asks again.
  await poll(url, '')
  // So no request waits to carry a close, and the server drops it without one.
  await (await opened).closed()
  assert.equal(app.io.engine.clientsCount, 2)
})

test('over polling, a client that ignores the refusal is closed once it has read the code', async (t) => {
  const { app, url } = await server(t)
  await open(t, app, url)
  await open(t, app, url)
  const opened = nextConnection(app)
  const { sid } = JSON.parse((await poll(url, '')).slice(1)) as { sid: string }
  const { closed } = await opened
  assert.equal(await poll(url, `&sid=${sid}`, '40'), 'ok')
  assert.equal(await poll(url, `&sid=${sid}`), '44{"message":"too-many-connections"}')
  // It never polls again, and the server doesn't wait for it to.
  await closed()
  assert.equal(app.io.engine.clientsCount, 2)
})

test('past the max and as many again waiting for their refusals, a connection is refused before it opens', async (t) => {
  const { app, url } = await server(t)
  // Scripts that never ask for a socket, one after another, as a flood would open them.
  const outcomes = []
  for (let tries = 1; tries <= 10; tries++) outcomes.push(await raw(t, url).opened())
  // 2 in the count, 2 past it waiting for the grace, and the rest refused.
  assert.deepEqual(outcomes, [true, true, true, true, false, false, false, false, false, false])
  assert.equal(app.io.engine.clientsCount, 4)
})

/** A client's options with `forwarded` as its X-Forwarded-For. */
const from = (forwarded: string) => ({
  extraHeaders: { origin: ORIGIN, 'x-forwarded-for': forwarded },
})

test('a faked leftmost forwarded address is ignored on sockets: they count by the rightmost', async (t) => {
  const { app, url } = await server(t, { trustProxy: 1 })
  // Each client writes a different address of its own before the one the proxy added.
  assert.equal((await open(t, app, url, from('1.1.1.1, 198.51.100.4'))).outcome, true)
  assert.equal((await open(t, app, url, from('2.2.2.2, 198.51.100.4'))).outcome, true)
  assert.equal(
    (await open(t, app, url, from('3.3.3.3, 198.51.100.4'))).outcome,
    'too-many-connections',
  )
  // Another client of the proxy's has places of its own, whatever it writes first.
  assert.equal((await open(t, app, url, from('198.51.100.4, 203.0.113.9'))).outcome, true)
})

test('a faked leftmost forwarded address is ignored on REST too', async () => {
  const app = buildApp({ trustProxy: 1 })
  app.get('/ip', async (request) => ({ ip: request.ip }))
  const response = await app.inject({
    method: 'GET',
    url: '/ip',
    remoteAddress: '10.0.0.2',
    headers: { 'x-forwarded-for': '1.1.1.1, 198.51.100.4' },
  })
  assert.deepEqual(response.json(), { ip: '198.51.100.4' })
})

test("with no proxy trusted, X-Forwarded-For buys no places: the connection's address counts", async (t) => {
  const { app, url } = await server(t)
  assert.equal((await open(t, app, url, from('1.1.1.1'))).outcome, true)
  assert.equal((await open(t, app, url, from('2.2.2.2'))).outcome, true)
  assert.equal((await open(t, app, url, from('3.3.3.3'))).outcome, 'too-many-connections')
})

test('without the option, an address may have 10 connections open', async (t) => {
  const app = buildApp({ corsOrigins: [ORIGIN], verify })
  const url = await listen(t, app)
  for (let count = 1; count <= 10; count++)
    assert.equal((await open(t, app, url)).outcome, true, String(count))
  assert.equal((await open(t, app, url)).outcome, 'too-many-connections')
})
