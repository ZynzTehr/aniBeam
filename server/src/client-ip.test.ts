import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import { test, type TestContext } from 'node:test'
import { buildApp } from './app.ts'
import type { TrustProxy } from './client-ip.ts'
import { client, connected, listen, next, ORIGIN, within } from './testing/sockets.ts'

// Which IP a request comes from (client-ip.ts): REST's request.ip, and app.clientIp() for a
// socket's request, which Fastify never sees, by one rule.

/** A proxy in front of the server, a client behind it, and an address a client makes up. */
const PROXY = '10.0.0.2'
const CLIENT = '198.51.100.4'
const FAKE = '6.6.6.6'

/**
 * What REST's request.ip and app.clientIp() say for a request from `from`, with the headers
 * `headers`, to an app trusting `trustProxy`.
 */
async function addresses(
  trustProxy: TrustProxy,
  from: string,
  headers: Record<string, string | string[]> = {},
) {
  const app = buildApp({ trustProxy })
  app.get('/ip', async (request) => ({ ip: request.ip, clientIp: app.clientIp(request.raw) }))
  const response = await app.inject({ method: 'GET', url: '/ip', remoteAddress: from, headers })
  return response.json<{ ip: string; clientIp: string }>()
}

/** What REST and app.clientIp() both say, failing if they differ. */
async function address(
  trustProxy: TrustProxy,
  from: string,
  headers: Record<string, string | string[]> = {},
) {
  const { ip, clientIp } = await addresses(trustProxy, from, headers)
  assert.equal(clientIp, ip, 'REST and clientIp() differ')
  return ip
}

test("with no proxy trusted, it is the connection's address, and X-Forwarded-For is never read", async () => {
  assert.equal(await address(undefined, CLIENT), CLIENT)
  assert.equal(await address(undefined, CLIENT, { 'x-forwarded-for': FAKE }), CLIENT)
  assert.equal(await address(undefined, PROXY, { 'x-forwarded-for': `${FAKE}, ${CLIENT}` }), PROXY)
})

test('with one hop trusted, it is the rightmost forwarded entry, never the leftmost a client writes', async () => {
  // The proxy adds the address it got the request from at the end, after whatever the client
  // wrote itself.
  assert.equal(await address(1, PROXY, { 'x-forwarded-for': CLIENT }), CLIENT)
  assert.equal(await address(1, PROXY, { 'x-forwarded-for': `${FAKE}, ${CLIENT}` }), CLIENT)
  assert.equal(
    await address(1, PROXY, { 'x-forwarded-for': `${FAKE}, 7.7.7.7, ${CLIENT}` }),
    CLIENT,
  )
  // With no header, the connection's.
  assert.equal(await address(1, PROXY), PROXY)
})

test("with the proxy's address trusted, only that proxy's entries are read", async () => {
  const forwarded = { 'x-forwarded-for': `${FAKE}, ${CLIENT}` }
  assert.equal(await address([PROXY], PROXY, forwarded), CLIENT)
  // A client that reaches the server around the proxy gets its own address, whatever it writes.
  assert.equal(await address([PROXY], '192.0.2.9', forwarded), '192.0.2.9')
  // The proxy's IPv4 address as a server listening on :: sees it.
  assert.equal(await address([PROXY], `::ffff:${PROXY}`, forwarded), CLIENT)
  // Two proxies in a row, each trusted: the entry before the second's.
  assert.equal(
    await address(['10.0.0.2', '10.0.0.3'], PROXY, {
      'x-forwarded-for': `${FAKE}, ${CLIENT}, 10.0.0.3`,
    }),
    CLIENT,
  )
  assert.equal(await address(['fd00::2'], 'fd00::2', forwarded), CLIENT)
})

test("REST's request.ip and clientIp() agree on every request, however the header is written", async () => {
  for (const trustProxy of [undefined, 1, [PROXY]] as const)
    for (const header of [
      CLIENT,
      ` ${CLIENT} `,
      `${FAKE},${CLIENT}`,
      `${FAKE} ,\t${CLIENT}\t`,
      `${FAKE}, , ${CLIENT},`,
      `${CLIENT}, ${PROXY}`,
      `${PROXY}, ${PROXY}`,
      ',',
      '',
      'not an address',
      [FAKE, CLIENT],
    ]) {
      const { ip, clientIp } = await addresses(trustProxy, PROXY, { 'x-forwarded-for': header })
      assert.equal(clientIp, ip, `${JSON.stringify(trustProxy)} ${JSON.stringify(header)}`)
    }
})

/** A listening app trusting `trustProxy`, whose /ip answers REST's request.ip, and its address. */
async function server(t: TestContext, trustProxy: TrustProxy) {
  const app = buildApp({ corsOrigins: [ORIGIN], trustProxy })
  app.get('/ip', async (request) => ({ ip: request.ip }))
  return { app, url: await listen(t, app) }
}

/** What a socket from this computer, sending `headers`, gets as its address, and what REST does. */
async function overTheNetwork(
  t: TestContext,
  trustProxy: TrustProxy,
  headers: Record<string, string>,
) {
  const { app, url } = await server(t, trustProxy)
  const opened = next<{ request: IncomingMessage }>(app.io.engine, 'connection')
  await within(
    connected(client(t, url, { extraHeaders: { origin: ORIGIN, ...headers } })),
    'connected',
  )
  const socket = app.clientIp((await opened).request)
  const response = await fetch(`${url}/ip`, { headers })
  const { ip } = (await response.json()) as { ip: string }
  return { socket, rest: ip }
}

test("a socket's address is read from its request by the same rule as REST's", async (t) => {
  const forwarded = { 'x-forwarded-for': `${FAKE}, ${CLIENT}` }
  assert.deepEqual(await overTheNetwork(t, 1, forwarded), { socket: CLIENT, rest: CLIENT })
  assert.deepEqual(await overTheNetwork(t, ['127.0.0.1'], forwarded), {
    socket: CLIENT,
    rest: CLIENT,
  })
  assert.deepEqual(await overTheNetwork(t, undefined, forwarded), {
    socket: '127.0.0.1',
    rest: '127.0.0.1',
  })
})
