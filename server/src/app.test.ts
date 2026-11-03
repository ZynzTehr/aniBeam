import assert from 'node:assert/strict'
import { once } from 'node:events'
import { connect, type AddressInfo } from 'node:net'
import { test } from 'node:test'
import pg from 'pg'
import { buildApp } from './app.ts'

test('GET /health answers ok', async () => {
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { ok: true })
})

test('a request body over 4 KB is refused with 413, and one of 4 KB is read', async () => {
  const app = buildApp()
  app.post('/echo', async (request) => request.body)
  // {"text":""} is 11 bytes, so this makes a body of `size` bytes.
  const send = (size: number) =>
    app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ text: 'a'.repeat(size - 11) }),
    })
  assert.equal((await send(4096)).statusCode, 200)
  assert.equal((await send(4097)).statusCode, 413)
})

test('an address no route has answers 404 with the code not-found, not "Not Found"', async () => {
  const app = buildApp()
  for (const request of [
    { method: 'GET', url: '/nothing-here' },
    { method: 'DELETE', url: '/health' },
  ] as const) {
    const response = await app.inject(request)
    assert.equal(response.statusCode, 404, request.url)
    assert.deepEqual(response.json(), { error: 'not-found' }, request.url)
  }
})

test('what Fastify refuses in a body answers the code invalid, not "Bad Request"', async () => {
  const app = buildApp()
  app.post('/echo', async (request) => request.body)
  const send = (type: string, payload: string) =>
    app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': type }, payload })
  for (const [status, type, payload] of [
    [400, 'application/json', '{"text":'],
    [400, 'application/json', ''],
    [413, 'application/json', JSON.stringify({ text: 'a'.repeat(4096) })],
    [415, 'text/xml', '<text/>'],
  ] as const) {
    const response = await send(type, payload)
    assert.equal(response.statusCode, status, payload.slice(0, 20))
    assert.deepEqual(response.json(), { error: 'invalid' }, payload.slice(0, 20))
  }
})

test('a request Node cannot read as HTTP answers the code invalid too', async (t) => {
  const app = buildApp()
  await app.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => app.close())
  const { port } = app.server.address() as AddressInfo
  /** Sends `request` as it is, and returns the answer whole, once the server ends it. */
  const raw = async (request: string) => {
    const socket = connect(port, '127.0.0.1')
    let answer = ''
    socket.setEncoding('utf8').on('data', (chunk: string) => (answer += chunk))
    socket.end(request)
    await once(socket, 'close')
    return answer
  }
  // A first line that isn't HTTP, and headers over Node's 16 KB.
  const broken = await raw('NOT HTTP\r\n\r\n')
  const big = await raw(`GET /health HTTP/1.1\r\nHost: x\r\nX-Big: ${'a'.repeat(17_000)}\r\n\r\n`)
  assert.match(broken, /^HTTP\/1\.1 400 /)
  assert.match(big, /^HTTP\/1\.1 431 /)
  for (const answer of [broken, big])
    assert.equal(answer.split('\r\n\r\n')[1], '{"error":"invalid"}')
})

test('a failure answers 500 without its message, which can hold the SQL that failed', async (t) => {
  // Nothing listens on port 1, so the query fails.
  const pool = new pg.Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/none' })
  const app = buildApp({ pool })
  t.after(() => pool.end())
  const response = await app.inject({ method: 'GET', url: '/rooms/anime:1:all/messages' })
  assert.equal(response.statusCode, 500)
  assert.deepEqual(response.json(), { statusCode: 500, error: 'Internal Server Error' })
})
