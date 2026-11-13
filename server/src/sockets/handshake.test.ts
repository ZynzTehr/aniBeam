import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { buildApp } from '../app.ts'
import { BadToken, type Verify } from '../auth/verify.ts'
import type { ChatSocket } from '../sockets/sockets.ts'
import { client, connected, listen, next, ORIGIN, within } from '../testing/sockets.ts'

// A socket's sign-in: the token in the handshake's auth, checked by the verifier REST uses.

/** A token whose check fails as Google's keys failing to load would: the server's trouble. */
const KEYS_FAIL = 'token-keys-fail'

const verify: Verify = async (token) => {
  if (token === KEYS_FAIL) throw new Error('Google keys did not load')
  if (token !== 'token-aki') throw new BadToken('unknown test token')
  return { uid: 'uid-aki' }
}

/** A listening app with the verifier, and its address. */
async function server(t: TestContext) {
  const app = buildApp({ corsOrigins: [ORIGIN], verify })
  return { app, url: await listen(t, app) }
}

/** Connects with `options`, and gives the server's side of the socket. */
async function open(t: TestContext, options: Parameters<typeof client>[2]) {
  const { app, url } = await server(t)
  const arrived = next<ChatSocket>(app.io, 'connection')
  await within(connected(client(t, url, options)), 'connected')
  return arrived
}

test('with no token, the socket opens signed out, with no uid', async (t) => {
  const socket = await open(t, {})
  assert.equal(socket.data.uid, undefined)
})

test("with a good token in the handshake's auth, the socket has its uid", async (t) => {
  const socket = await open(t, { auth: { token: 'token-aki' } })
  assert.equal(socket.data.uid, 'uid-aki')
})

test('a token the verifier refuses gives connect_error bad-token, and no socket', async (t) => {
  const { app, url } = await server(t)
  let opened = 0
  app.io.on('connection', () => opened++)
  for (const token of ['token-nobody', '', 42, null, { token: 'token-aki' }]) {
    const socket = client(t, url, { auth: { token } })
    await assert.rejects(within(connected(socket), 'connect_error'), { message: 'bad-token' })
  }
  assert.equal(opened, 0)
})

test('when the verifier itself fails, it is connect_error server-error, not bad-token', async (t) => {
  const { url } = await server(t)
  const socket = client(t, url, { auth: { token: KEYS_FAIL } })
  await assert.rejects(within(connected(socket), 'connect_error'), { message: 'server-error' })
})

test('a token in the query or a header is never read: the socket opens signed out', async (t) => {
  const socket = await open(t, {
    query: { token: 'token-aki', uid: 'uid-aki' },
    extraHeaders: { origin: ORIGIN, authorization: 'Bearer token-aki' },
  })
  assert.equal(socket.data.uid, undefined)
})
