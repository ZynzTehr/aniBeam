import assert from 'node:assert/strict'
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

test('a failure answers 500 without its message, which can hold the SQL that failed', async (t) => {
  // Nothing listens on port 1, so the query fails.
  const pool = new pg.Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/none' })
  const app = buildApp({ pool })
  t.after(() => pool.end())
  const response = await app.inject({ method: 'GET', url: '/rooms/anime:1:all/messages' })
  assert.equal(response.statusCode, 500)
  assert.deepEqual(response.json(), { statusCode: 500, error: 'Internal Server Error' })
})
