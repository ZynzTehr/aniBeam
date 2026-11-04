import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import pg from 'pg'
import { buildApp } from './app.ts'
import { BadToken } from './auth/verify.ts'

// The web app's origins, as CORS_ORIGIN would list them.
const WEB = 'https://ani-beam.vercel.app'
const DEV = 'http://localhost:5173'

// The routes for a signed-in user need a pool, but the answers here are refused before any
// query, so it points at nothing: nothing listens on port 1.
const pool = new pg.Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/none' })
const app = buildApp({
  pool,
  verify: async () => Promise.reject(new BadToken('no token is good here')),
  corsOrigins: [WEB, DEV],
})
after(async () => {
  await app.close()
  await pool.end()
})

/** A request from a page at `origin`, if any. */
const from = (origin: string | undefined, url = '/health', method: 'GET' | 'POST' = 'GET') =>
  app.inject({ method, url, headers: origin === undefined ? {} : { origin } })

/** A preflight from a page at `origin`, asking to POST with Authorization and a JSON body. */
const preflight = (origin: string, url = '/me/handle') =>
  app.inject({
    method: 'OPTIONS',
    url,
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type',
    },
  })

test("the web app's origins get ACAO naming them, and Vary: Origin", async () => {
  for (const origin of [WEB, DEV]) {
    const response = await from(origin)
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['access-control-allow-origin'], origin)
    assert.equal(response.headers.vary, 'Origin')
  }
})

test('an unknown origin gets no ACAO, nor a lookalike or "null", and still Vary: Origin', async () => {
  for (const origin of [
    'https://evil.example',
    // The web app's host as the start of a longer one, and as part of a path.
    'https://ani-beam.vercel.app.evil.com',
    'https://evil.example/https://ani-beam.vercel.app',
    // A file, or a sandboxed page.
    'null',
    // The same host over http, on a port, in capitals, or with a / at the end.
    'http://ani-beam.vercel.app',
    'https://ani-beam.vercel.app:8443',
    'https://ANI-BEAM.vercel.app',
    'https://ani-beam.vercel.app/',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    `${WEB}, https://evil.example`,
    '*',
    '',
  ]) {
    const response = await from(origin)
    assert.equal(response.headers['access-control-allow-origin'], undefined, origin)
    assert.equal(response.headers.vary, 'Origin', origin)
  }
})

test('a request with no Origin, as curl sends, gets no ACAO and still Vary: Origin', async () => {
  const response = await from(undefined)
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['access-control-allow-origin'], undefined)
  assert.equal(response.headers.vary, 'Origin')
})

test('the preflight allows Authorization and Content-Type, and GET and POST', async () => {
  for (const url of ['/me/handle', '/me', '/rooms/anime:1:all/messages']) {
    const response = await preflight(WEB, url)
    assert.equal(response.statusCode, 204, url)
    assert.equal(response.body, '', url)
    assert.equal(response.headers['access-control-allow-origin'], WEB, url)
    assert.equal(response.headers['access-control-allow-headers'], 'Authorization, Content-Type')
    assert.equal(response.headers['access-control-allow-methods'], 'GET, POST')
    assert.equal(response.headers['access-control-max-age'], '600')
    assert.equal(response.headers.vary, 'Origin', url)
  }
})

test('a preflight from an unknown origin is allowed nothing', async () => {
  for (const origin of ['https://evil.example', 'https://ani-beam.vercel.app.evil.com', 'null']) {
    const response = await preflight(origin)
    assert.equal(response.statusCode, 204, origin)
    for (const name of [
      'access-control-allow-origin',
      'access-control-allow-headers',
      'access-control-allow-methods',
    ])
      assert.equal(response.headers[name], undefined, `${origin}: ${name}`)
    assert.equal(response.headers.vary, 'Origin', origin)
  }
})

test("refusals carry the headers too, so the web app can read the error's code", async () => {
  for (const [url, method, status] of [
    ['/me', 'GET', 401],
    ['/me/handle', 'POST', 401],
    ['/nothing-here', 'GET', 404],
    // Fastify refuses a bad %-escape before any route, or the hooks, see it.
    ['/rooms/anime:%ZZ:all/messages', 'GET', 400],
  ] as const) {
    const response = await from(WEB, url, method)
    assert.equal(response.statusCode, status, url)
    assert.equal(response.headers['access-control-allow-origin'], WEB, url)
    assert.equal(response.headers.vary, 'Origin', url)
  }
})

test('no answer allows credentials: the token goes in a header, not a cookie', async () => {
  for (const response of [await from(WEB), await preflight(WEB), await from(WEB, '/me')])
    assert.equal(response.headers['access-control-allow-credentials'], undefined)
})

test('with no origins given, no origin is allowed', async () => {
  const plain = buildApp()
  try {
    const response = await plain.inject({ method: 'GET', url: '/health', headers: { origin: DEV } })
    assert.equal(response.headers['access-control-allow-origin'], undefined)
    assert.equal(response.headers.vary, 'Origin')
  } finally {
    await plain.close()
  }
})
