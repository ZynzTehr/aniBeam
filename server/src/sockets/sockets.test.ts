import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildApp } from '../app.ts'
import { client, connected, listen, next, ORIGIN, within } from '../testing/sockets.ts'

// Socket.IO on the app's own HTTP server: who may open a socket, and how big a packet may be.

const EVIL = 'https://evil.example'

/** An app that allows ORIGIN's pages, listening, and its address. */
async function server(t: Parameters<typeof listen>[0]) {
  const app = buildApp({ corsOrigins: [ORIGIN] })
  return { app, url: await listen(t, app) }
}

test('a page from an allowed origin opens a socket, over WebSocket and over polling', async (t) => {
  const { url } = await server(t)
  for (const transports of [['websocket'], ['polling']]) {
    const socket = client(t, url, { transports })
    await within(connected(socket), `${transports[0]} connected`)
    assert.equal(socket.io.engine.transport.name, transports[0])
  }
})

test("another site's page is refused over WebSocket, which CORS does not cover", async (t) => {
  const { app, url } = await server(t)
  let opened = 0
  app.io.engine.on('connection', () => opened++)
  const socket = client(t, url, { origin: EVIL })
  await assert.rejects(within(connected(socket), 'connect_error'), { message: 'websocket error' })
  assert.equal(opened, 0)
})

test("polling from another site's page answers 403", async (t) => {
  const { url } = await server(t)
  const handshake = `${url}/socket.io/?EIO=4&transport=polling`
  assert.equal((await fetch(handshake, { headers: { origin: EVIL } })).status, 403)
  // A lookalike too, as cors.ts refuses one: the origin is matched whole.
  const lookalike = { origin: `${ORIGIN}.evil.example` }
  assert.equal((await fetch(handshake, { headers: lookalike })).status, 403)
  assert.equal((await fetch(handshake, { headers: { origin: ORIGIN } })).status, 200)
})

test("polling answers name an allowed page's origin, so its browser lets the page read them", async (t) => {
  const { url } = await server(t)
  const polling = `${url}/socket.io/?EIO=4&transport=polling`
  // A browser reads a cross-site answer only if access-control-allow-origin names its page's
  // origin. Node's client never checks, so the headers are checked here.
  const opened = await fetch(polling, { headers: { origin: ORIGIN } })
  assert.equal(opened.status, 200)
  assert.equal(opened.headers.get('access-control-allow-origin'), ORIGIN)
  assert.match(opened.headers.get('vary') ?? '', /\bOrigin\b/)
  assert.equal(opened.headers.get('access-control-allow-credentials'), null)
  // The socket's later requests, with its sid, as well.
  const { sid } = JSON.parse((await opened.text()).slice(1)) as { sid: string }
  const headers = { origin: ORIGIN, 'content-type': 'text/plain;charset=UTF-8' }
  const sent = await fetch(`${polling}&sid=${sid}`, { method: 'POST', headers, body: '40' })
  assert.equal(await sent.text(), 'ok')
  assert.equal(sent.headers.get('access-control-allow-origin'), ORIGIN)
  // A preflight, which a browser sends first when a request has headers of its own.
  const ask = (origin: string) =>
    fetch(polling, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST' },
    })
  const allowed = await ask(ORIGIN)
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers.get('access-control-allow-origin'), ORIGIN)
  // Another site's page, or a lookalike, gets no such header, and is refused as before.
  for (const origin of [EVIL, `${ORIGIN}.evil.example`]) {
    const refused = await fetch(polling, { headers: { origin } })
    assert.equal(refused.status, 403, origin)
    assert.equal(refused.headers.get('access-control-allow-origin'), null, origin)
    assert.equal((await ask(origin)).headers.get('access-control-allow-origin'), null, origin)
  }
})

test('a request with no Origin is refused, over polling and WebSocket', async (t) => {
  const { app, url } = await server(t)
  let opened = 0
  app.io.engine.on('connection', () => opened++)
  assert.equal((await fetch(`${url}/socket.io/?EIO=4&transport=polling`)).status, 403)
  for (const transports of [['websocket'], ['polling']]) {
    const socket = client(t, url, { origin: null, transports })
    await assert.rejects(within(connected(socket), 'connect_error'), transports[0])
  }
  assert.equal(opened, 0)
})

test('app.close() with a socket open finishes within 1 s', async (t) => {
  const { app, url } = await server(t)
  for (const transports of [['websocket'], ['polling']])
    await within(connected(client(t, url, { transports })), 'connected')
  const started = performance.now()
  let timer: NodeJS.Timeout | undefined
  await Promise.race([
    app.close(),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('app.close() took over 1 s')), 1000)
    }),
  ]).finally(() => clearTimeout(timer))
  assert.ok(performance.now() - started < 1000)
})

test('a packet over 16 KB closes the socket, over WebSocket and polling', async (t) => {
  const { app, url } = await server(t)
  let heard = 0
  app.io.on('connection', (socket) => socket.on('test:big', () => heard++))
  for (const transports of [['websocket'], ['polling']]) {
    const socket = client(t, url, { transports })
    await within(connected(socket), 'connected')
    const closed = next<string>(socket, 'disconnect')
    socket.emit('test:big', 'a'.repeat(20 * 1024))
    assert.match(await closed, /^transport (close|error)$/, transports[0])
  }
  assert.equal(heard, 0)
})

test('5 messages of 500 emoji sent at once over polling all arrive, even in one request', async (t) => {
  const { app, url } = await server(t)
  const bodies: string[] = []
  let heard: () => void
  const all = () => new Promise<void>((resolve) => (heard = resolve))
  app.io.on('connection', (socket) =>
    socket.on('test:send', (body: string) => {
      if (bodies.push(body) % 5 === 0) heard()
    }),
  )
  // A message's longest body, 500 code points, of emoji, which take 4 bytes each.
  const body = '😀'.repeat(500)

  // Socket.IO's own client, which sends what has waited in one request, but no more than the
  // server's limit in each.
  const socket = client(t, url, { transports: ['polling'] })
  await within(connected(socket), 'connected')
  let arrived = all()
  for (let i = 0; i < 5; i++) socket.emit('test:send', body)
  await within(arrived, "5 messages from Socket.IO's client")
  assert.ok(socket.connected)

  // And the five in one request, as any client may send them: about 10 KB, under 16 KB.
  const polling = `${url}/socket.io/?EIO=4&transport=polling`
  const headers = { origin: ORIGIN, 'content-type': 'text/plain;charset=UTF-8' }
  const opened = await (await fetch(polling, { headers })).text()
  const { sid } = JSON.parse(opened.slice(1)) as { sid: string }
  const session = `${polling}&sid=${sid}`
  assert.equal(await (await fetch(session, { method: 'POST', headers, body: '40' })).text(), 'ok')
  // The server's answer to the namespace's connect, once the socket is in it.
  assert.match(await (await fetch(session, { headers })).text(), /^40/)
  const batch = Array(5)
    .fill(`42${JSON.stringify(['test:send', body])}`)
    .join('\x1e')
  assert.ok(Buffer.byteLength(batch) > 10_000 && Buffer.byteLength(batch) < 16 * 1024)
  arrived = all()
  const sent = await fetch(session, { method: 'POST', headers, body: batch })
  assert.equal(sent.status, 200)
  await within(arrived, '5 messages in one request')
  assert.deepEqual(bodies, Array(10).fill(body))
})
