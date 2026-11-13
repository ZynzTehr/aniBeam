import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import pg from 'pg'
import { buildApp } from '../app.ts'
import { BadToken, firebaseVerifier, type Verify } from '../auth/verify.ts'
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

/** Users made so far by newUser(). */
let made = 0

/** A user no other test has, with a token the verifier takes. */
function newUser() {
  const name = `user${++made}`
  TOKENS[`token-${name}`] = `uid-${name}`
  return { token: `token-${name}`, uid: `uid-${name}` }
}

/** POST /me/handle with this token, if any, and body, sent as JSON unless it is a string. */
const pick = (
  token: string | undefined,
  body: unknown,
  headers: Record<string, string> = {},
  url = '/me/handle',
) =>
  app.inject({
    method: 'POST',
    url,
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...headers },
    ...(body !== undefined && { payload: body as string }),
  })

/** Every user's uid and handle, in the order the rows were made. */
const everyone = async () =>
  (await db.pool.query('select auth_uid, handle from users order by id')).rows

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
  assert.deepEqual(response.json(), { error: 'server-error' })
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

test('POST /me/handle makes the account with that handle, which GET /me then answers', async () => {
  const user = newUser()
  const response = await pick(user.token, { handle: 'Aki_01' })
  assert.equal(response.statusCode, 201, response.body)
  assert.deepEqual(response.json(), { handle: 'Aki_01', banned: false })
  // The row holds the uid and the handle as written, and nothing else of the user's.
  const { rows } = await db.pool.query('select * from users where auth_uid = $1', [user.uid])
  assert.deepEqual(Object.keys(rows[0]), ['id', 'auth_uid', 'handle', 'created_at', 'banned_at'])
  assert.deepEqual(rows, [{ ...rows[0], auth_uid: user.uid, handle: 'Aki_01', banned_at: null }])
  assert.deepEqual((await me({ authorization: `Bearer ${user.token}` })).json(), {
    handle: 'Aki_01',
    banned: false,
  })
})

test('a handle of 3 characters fits, and so does one of 20', async () => {
  for (const handle of ['abc', 'A'.repeat(20), '___', '007'])
    assert.equal((await pick(newUser().token, { handle })).statusCode, 201, handle)
})

test('a handle someone has, written in any case, answers 409 handle-taken', async () => {
  const user = newUser()
  const before = await everyone()
  for (const handle of ['Rei', 'rei', 'REI', 'rEi']) {
    const response = await pick(user.token, { handle })
    assert.equal(response.statusCode, 409, handle)
    assert.deepEqual(response.json(), { error: 'handle-taken' }, handle)
  }
  assert.deepEqual(await everyone(), before)
})

test('a user who has a handle gets 409 handle-already-set, and keeps the first', async () => {
  const user = newUser()
  assert.equal((await pick(user.token, { handle: 'Hoshi' })).statusCode, 201)
  // Another handle, the same one, the same in another case, and someone else's.
  for (const handle of ['Hoshi2', 'Hoshi', 'hoshi', 'Rei']) {
    const response = await pick(user.token, { handle })
    assert.equal(response.statusCode, 409, handle)
    assert.deepEqual(response.json(), { error: 'handle-already-set' }, handle)
  }
  assert.deepEqual((await me({ authorization: `Bearer ${user.token}` })).json(), {
    handle: 'Hoshi',
    banned: false,
  })
  // A banned user has a row, so a handle too.
  assert.deepEqual((await pick('token-banned', { handle: 'unbanned' })).json(), {
    error: 'handle-already-set',
  })
})

test('a handle with a character outside A to Z, a to z, 0 to 9 and _, or not 3 to 20 long, answers 400 invalid', async () => {
  const user = newUser()
  for (const handle of [
    '',
    'ab',
    'a'.repeat(21),
    'aki!',
    'a ki',
    ' aki',
    'aki-chan',
    'aki.b',
    'äki',
    'Åsa',
    'ａｋｉ',
    'アキ',
    'aki\n',
    'aki\u0000',
    'aki😀',
  ]) {
    const response = await pick(user.token, { handle })
    assert.equal(response.statusCode, 400, JSON.stringify(handle))
    assert.deepEqual(response.json(), { error: 'invalid' }, JSON.stringify(handle))
  }
  assert.deepEqual((await me({ authorization: `Bearer ${user.token}` })).json(), {
    handle: null,
    banned: false,
  })
})

test('a body that is not { handle } answers 400 invalid', async () => {
  const user = newUser()
  const json = { 'content-type': 'application/json' }
  for (const [body, headers] of [
    [undefined, {}],
    ['', json],
    ['{"handle":', json],
    ['null', json],
    ['"aki_b"', json],
    ['["aki_b"]', json],
    ['{}', json],
    ['{"handle":5}', json],
    ['{"handle":null}', json],
    ['{"handle":["aki_b"]}', json],
    ['{"Handle":"aki_b"}', json],
    ['{"handle":"aki_b","spoiler":true}', json],
    ['handle=aki_b', { 'content-type': 'application/x-www-form-urlencoded' }],
    ['aki_b', { 'content-type': 'text/plain' }],
  ] as const) {
    const response = await pick(user.token, body, headers)
    assert.ok([400, 415].includes(response.statusCode), `${body}: ${response.statusCode}`)
    assert.deepEqual(response.json(), { error: 'invalid' }, body)
  }
  assert.deepEqual((await me({ authorization: `Bearer ${user.token}` })).json(), {
    handle: null,
    banned: false,
  })
})

test('POST /me/handle with no token, a malformed header or a bad token answers 401, and makes no row', async () => {
  const before = await everyone()
  for (const [headers, error] of [
    [{}, 'sign-in-required'],
    [{ authorization: 'Basic token-aki' }, 'bad-token'],
    [{ authorization: 'token-aki' }, 'bad-token'],
    [{ authorization: 'Bearer token-nobody' }, 'bad-token'],
    [{ authorization: 'Bearer dev:aki' }, 'bad-token'],
  ] as const) {
    const response = await pick(undefined, { handle: 'Nobody' }, headers)
    assert.equal(response.statusCode, 401, JSON.stringify(headers))
    assert.deepEqual(response.json(), { error }, JSON.stringify(headers))
  }
  // The token is checked before the body is read, so a broken body with no token is a 401.
  const broken = await pick(undefined, '{"handle":', { 'content-type': 'application/json' })
  assert.deepEqual([broken.statusCode, broken.json()], [401, { error: 'sign-in-required' }])
  assert.deepEqual(await everyone(), before)
})

test("a body carrying a uid, or another account's handle, changes nothing about whose row is made", async () => {
  const user = newUser()
  const before = await everyone()
  for (const body of [
    { handle: 'Kaze', uid: 'uid-rei' },
    { handle: 'Kaze', authUid: 'uid-rei' },
    { handle: 'Kaze', auth_uid: 'uid-rei' },
    { handle: 'Kaze', userId: 1 },
    { handle: 'Kaze', id: 1 },
    { uid: 'uid-rei', handle: 'Kaze' },
  ]) {
    const response = await pick(user.token, body)
    assert.equal(response.statusCode, 400, JSON.stringify(body))
    assert.deepEqual(response.json(), { error: 'invalid' }, JSON.stringify(body))
  }
  assert.deepEqual(await everyone(), before)
  // Rei's handle stays Rei's.
  assert.deepEqual((await pick(user.token, { handle: 'Rei' })).json(), { error: 'handle-taken' })
  // A uid in a header or the address is never read: the row is the token's.
  const response = await pick(
    user.token,
    { handle: 'Kaze' },
    { 'x-user-id': 'uid-rei', 'x-uid': 'uid-rei' },
    '/me/handle?uid=uid-rei',
  )
  assert.equal(response.statusCode, 201, response.body)
  assert.deepEqual(await everyone(), [...before, { auth_uid: user.uid, handle: 'Kaze' }])
})

test('ten users asking for one handle at once: one gets it, nine get 409 handle-taken, none a 500', async () => {
  const racers = Array.from({ length: 10 }, newUser)
  const answers = await Promise.all(racers.map((user) => pick(user.token, { handle: 'Mika' })))
  assert.deepEqual(answers.map((response) => response.statusCode).sort(), [
    201,
    ...Array(9).fill(409),
  ])
  for (const response of answers.filter((response) => response.statusCode === 409))
    assert.deepEqual(response.json(), { error: 'handle-taken' })
  const { rows } = await db.pool.query(
    "select count(*)::int from users where lower(handle) = 'mika'",
  )
  assert.deepEqual(rows, [{ count: 1 }])
})

test("a request for a handle another request has added but not yet saved waits, then answers 409 if it is saved and 201 if it isn't", async () => {
  for (const [end, handle, status, body] of [
    ['commit', 'Nagi', 409, { error: 'handle-taken' }],
    ['rollback', 'Umi', 201, { handle: 'UMI', banned: false }],
  ] as const) {
    const holder = await db.pool.connect()
    try {
      // The other request's row, added in a transaction that has not ended.
      await holder.query('begin')
      await holder.query('insert into users (auth_uid, handle) values ($1, $2)', [
        `uid-holder-${end}`,
        handle,
      ])
      const waiting = pick(newUser().token, { handle: handle.toUpperCase() })
      // The insert waits on the unique index, for the holder's transaction to end.
      for (let tries = 0; ; tries++) {
        const { rows } = await db.pool.query(
          `select count(*)::int as waiting from pg_locks
           where locktype = 'transactionid' and not granted`,
        )
        if (rows[0].waiting > 0) break
        assert.ok(tries < 500, 'the request never waited for the unsaved row')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      await holder.query(end)
      const response = await waiting
      assert.equal(response.statusCode, status, `${end}: ${response.body}`)
      assert.deepEqual(response.json(), body, end)
    } finally {
      // Closed, not given back, so that a transaction a failure left open goes with it.
      holder.release(true)
    }
  }
})

test('one user asking for two handles at once gets one, and 409 handle-already-set for the other', async () => {
  const user = newUser()
  const answers = await Promise.all([
    pick(user.token, { handle: 'Sora_a' }),
    pick(user.token, { handle: 'Sora_b' }),
  ])
  assert.deepEqual(answers.map((response) => response.statusCode).sort(), [201, 409])
  assert.deepEqual(answers.find((response) => response.statusCode === 409)?.json(), {
    error: 'handle-already-set',
  })
  const { rows } = await db.pool.query('select handle from users where auth_uid = $1', [user.uid])
  assert.equal(rows.length, 1)
})

test("when the database fails, the log keeps the query and its code, not the user's uid or handle", async (t) => {
  let log = ''
  // Port 1, where no Postgres is: every query fails to connect.
  const down = new pg.Pool({ connectionString: 'postgres://anibeam@127.0.0.1:1/anibeam' })
  t.after(() => down.end())
  const failing = buildApp({
    pool: down,
    verify: async () => ({ uid: 'uid-secret' }),
    logger: { stream: { write: (line) => void (log += line) } },
  })
  t.after(() => failing.close())
  const headers = { authorization: 'Bearer token-secret' }
  const asked = [
    await failing.inject({ method: 'GET', url: '/me', headers }),
    await failing.inject({
      method: 'POST',
      url: '/me/handle',
      headers,
      payload: { handle: 'SecretHandle' },
    }),
  ]
  // Each answers the code alone: no SQL, and none of the values the query was given.
  for (const response of asked) {
    assert.equal(response.statusCode, 500, response.body)
    assert.equal(response.body, '{"error":"server-error"}')
  }
  assert.doesNotMatch(log, /uid-secret|SecretHandle/)
  // What the log does keep: which query failed, and why.
  assert.match(log, /"msg":"A database query failed"/)
  assert.match(log, /"query":"insert into \\"users\\"/)
  assert.match(log, /"code":"ECONNREFUSED"/)
})

test('a token as Firebase signs one makes a row of its uid and handle, and its email is kept nowhere', async (t) => {
  // Keys of this test's own, served from 127.0.0.1 as Google serves its own (see verify.test.ts).
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'me-test', alg: 'RS256', use: 'sig' }
  const keys = createServer((_request, response) =>
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ keys: [jwk] })),
  )
  await new Promise<void>((resolve) => keys.listen(0, '127.0.0.1', resolve))
  t.after(() => keys.close())
  const keysUrl = new URL(`http://127.0.0.1:${(keys.address() as AddressInfo).port}/keys`)
  let log = ''
  const real = buildApp({
    pool: db.pool,
    verify: firebaseVerifier('anibeam-test', keysUrl),
    logger: { stream: { write: (line) => void (log += line) } },
  })
  t.after(() => real.close())

  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({
    name: 'Kiri Example',
    email: 'kiri@example.com',
    email_verified: true,
    auth_time: now - 60,
    user_id: 'uid-kiri-firebase',
    firebase: { identities: { email: ['kiri@example.com'] }, sign_in_provider: 'google.com' },
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'me-test' })
    .setIssuer('https://securetoken.google.com/anibeam-test')
    .setAudience('anibeam-test')
    .setSubject('uid-kiri-firebase')
    .setIssuedAt(now - 10)
    .setExpirationTime(now + 3600)
    .sign(privateKey)
  const headers = { authorization: `Bearer ${token}` }
  const response = await real.inject({
    method: 'POST',
    url: '/me/handle',
    headers,
    payload: { handle: 'Kiri' },
  })
  assert.equal(response.statusCode, 201, response.body)
  assert.deepEqual((await real.inject({ method: 'GET', url: '/me', headers })).json(), {
    handle: 'Kiri',
    banned: false,
  })
  const { rows } = await db.pool.query(
    "select auth_uid, handle from users where auth_uid = 'uid-kiri-firebase'",
  )
  assert.deepEqual(rows, [{ auth_uid: 'uid-kiri-firebase', handle: 'Kiri' }])
  // Every row of every table, written out, and the log hold neither the email nor the name.
  const { rows: tables } = await db.pool.query(
    `select (select json_agg(t)::text from users t) as users,
       (select json_agg(t)::text from messages t) as messages,
       (select json_agg(t)::text from reports t) as reports`,
  )
  assert.match(tables[0].users, /uid-kiri-firebase/)
  assert.doesNotMatch(JSON.stringify(tables) + log, /kiri@example\.com|Kiri Example/)
  // Nor does the log hold the token, or its signature alone.
  assert.ok(!log.includes(token.split('.')[2]), 'the log holds the token')
})
