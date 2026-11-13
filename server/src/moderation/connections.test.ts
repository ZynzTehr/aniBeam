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

/** A listening app allowing 2 connections per IP, trusting `trustProxy`, and its address. */
async function server(t: TestContext, trustProxy?: TrustProxy) {
  const app = buildApp({ corsOrigins: [ORIGIN], maxConnectionsPerIp: 2, trustProxy, verify })
  return { app, url: await listen(t, app) }
}

type App = ReturnType<typeof buildApp>

/**
 * Opens a client with `options`, and gives the client, the server's raw connection for it, and
 * whether it connected (true) or the code its connect_error had.
 */
async function open(
  t: TestContext,
  app: App,
  url: string,
  options: Parameters<typeof client>[2] = {},
) {
  const opened = next<Connection>(app.io.engine, 'connection')
  const socket = client(t, url, options)
  const outcome = await within(
    connected(socket).then(
      () => true as const,
      (err: Error) => err.message,
    ),
    'connect or connect_error',
  )
  return { socket, connection: await opened, outcome }
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
  // Its client closes the connection, so the refusal doesn't hold a place either.
  await next(third.connection, 'close')
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
  await next(refused.connection, 'close')
  await close(first.socket, first.connection)
  assert.equal((await open(t, app, url)).outcome, true)
})

test('3 bad-token tries, once closed, still let good connections in', async (t) => {
  const { app, url } = await server(t)
  for (let tries = 1; tries <= 3; tries++) {
    const bad = await open(t, app, url, { auth: { token: 'token-nobody' } })
    assert.equal(bad.outcome, 'bad-token', `try ${tries}`)
    // Refused for its token, it never became a socket, and its client closed it.
    await next(bad.connection, 'close')
  }
  // Both places are free: the refused connections left no count behind.
  assert.equal((await open(t, app, url, { auth: { token: 'token-aki' } })).outcome, true)
  assert.equal((await open(t, app, url, { auth: { token: 'token-aki' } })).outcome, true)
})

/** A client's options with `forwarded` as its X-Forwarded-For. */
const from = (forwarded: string) => ({
  extraHeaders: { origin: ORIGIN, 'x-forwarded-for': forwarded },
})

test('a faked leftmost forwarded address is ignored on sockets: they count by the rightmost', async (t) => {
  const { app, url } = await server(t, 1)
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
