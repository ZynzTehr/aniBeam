import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { buildApp } from '../app.ts'
import { BadToken, type Verify } from '../auth/verify.ts'
import { testDatabase, type TestDatabase } from '../testing/database.ts'

// The routes for a signed-in user, with a verifier that knows a few tokens by name. What a real
// token proves is verify.test.ts's to check; here, what the routes do with the uid it gives.

/** The tokens the verifier takes, and the uid each proves. */
const TOKENS: Record<string, string> = {
  'token-aki': 'uid-aki',
  'token-rei': 'uid-rei',
  'token-banned': 'uid-banned',
}
/** A token whose check fails as Google's keys failing to load would: the server's trouble. */
const KEYS_FAIL = 'token-keys-fail'

const verify: Verify = async (token) => {
  if (token === KEYS_FAIL) throw new Error('Google keys did not load')
  const uid = TOKENS[token]
  if (uid === undefined) throw new BadToken('unknown test token')
  return { uid }
}

let db: TestDatabase
let app: ReturnType<typeof buildApp>
before(async () => {
  db = await testDatabase()
  app = buildApp({ pool: db.pool, verify })
  await db.pool.query(
    `insert into users (auth_uid, handle, banned_at) values
       ('uid-rei', 'Rei', null), ('uid-banned', 'banned1', timestamptz '2026-11-01 12:00:00Z')`,
  )
})
after(async () => {
  await app?.close()
  await db?.close()
})

/** GET /me with these headers. */
const me = (headers: Record<string, string> = {}, url = '/me') =>
  app.inject({ method: 'GET', url, headers })

test('GET /me with no token answers 401 sign-in-required', async () => {
  const response = await me()
  assert.equal(response.statusCode, 401)
  assert.deepEqual(response.json(), { error: 'sign-in-required' })
  assert.equal(response.headers['www-authenticate'], 'Bearer')
})

test('an Authorization header that is not "Bearer <token>" answers 401 bad-token', async () => {
  for (const header of [
    '',
    'token-aki',
    'Basic token-aki',
    'Bearer',
    'Bearer ',
    'Bearertoken-aki',
    'Bearer token-aki extra',
    'Bearer token-aki ',
  ]) {
    const response = await me({ authorization: header })
    assert.equal(response.statusCode, 401, JSON.stringify(header))
    assert.deepEqual(response.json(), { error: 'bad-token' }, JSON.stringify(header))
  }
})

test('a token the verifier refuses answers 401 bad-token', async () => {
  for (const token of ['token-nobody', 'dev:aki', 'uid-aki']) {
    const response = await me({ authorization: `Bearer ${token}` })
    assert.equal(response.statusCode, 401, token)
    assert.deepEqual(response.json(), { error: 'bad-token' }, token)
  }
})

test('when the verifier itself fails, as when Google keys do not load, it is 500, not 401', async () => {
  const response = await me({ authorization: `Bearer ${KEYS_FAIL}` })
  assert.equal(response.statusCode, 500)
  assert.deepEqual(response.json(), { statusCode: 500, error: 'Internal Server Error' })
})

test('a signed-in user with no handle yet gets handle null, not banned', async () => {
  const response = await me({ authorization: 'Bearer token-aki' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { handle: null, banned: false })
})

test('a user with a handle gets it as they wrote it, and whether they are banned', async () => {
  assert.deepEqual((await me({ authorization: 'Bearer token-rei' })).json(), {
    handle: 'Rei',
    banned: false,
  })
  assert.deepEqual((await me({ authorization: 'Bearer token-banned' })).json(), {
    handle: 'banned1',
    banned: true,
  })
})

test('Bearer may be written in any case, and with more than one space', async () => {
  for (const header of ['bearer token-rei', 'BEARER token-rei', 'Bearer   token-rei'])
    assert.deepEqual((await me({ authorization: header })).json(), {
      handle: 'Rei',
      banned: false,
    })
})

test('the user is whoever the token proves, whatever uid a header or the address names', async () => {
  const response = await me(
    { authorization: 'Bearer token-aki', 'x-user-id': 'uid-rei', 'x-uid': 'uid-rei' },
    '/me?uid=uid-rei&handle=Rei',
  )
  assert.deepEqual(response.json(), { handle: null, banned: false })
})

test('a logged request contains no token text', async () => {
  let log = ''
  const logged = buildApp({
    pool: db.pool,
    verify,
    logger: { stream: { write: (line) => void (log += line) } },
  })
  // Fastify's own request log leaves headers out, so this hook logs them, as a line that adds
  // them might, alone and as part of a request.
  logged.addHook('onRequest', async (request) => {
    request.log.info({ headers: request.headers }, 'headers')
    request.log.info({ request: { headers: request.headers } }, 'request')
  })
  try {
    for (const token of ['token-rei', 'token-nobody', KEYS_FAIL])
      await logged.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      })
  } finally {
    await logged.close()
  }
  assert.doesNotMatch(log, /token-rei|token-nobody|token-keys-fail/)
  // And the log has a line from each part: the headers, a refused token and the 500's error.
  assert.match(log, /"authorization":"\[Redacted\]"/)
  assert.match(log, /"statusCode":401/)
  assert.match(log, /Google keys did not load/)
})
