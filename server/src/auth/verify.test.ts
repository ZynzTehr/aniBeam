import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { inspect } from 'node:util'
import {
  exportJWK,
  exportSPKI,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTPayload,
} from 'jose'
import { BadToken, CLOCK_TOLERANCE, firebaseVerifier, type Verify } from './verify.ts'

// Tokens here are signed by keys this file makes, and served as a JWK set from 127.0.0.1, as
// Google serves its own; nothing reaches Google (the fetch guard, src/testing/no-network.ts).
const PROJECT = 'anibeam-test'
const KID = 'test-key-1'

let privateKey: CryptoKey
let publicKey: CryptoKey
let server: Server
let keysUrl: URL
let verify: Verify
/** Whether the key server answers 500, as if Google's were failing. */
let keysFail = false
/** How many times the key server has been asked for the keys. */
let fetches = 0

before(async () => {
  ;({ privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true }))
  const keys = { keys: [{ ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' }] }
  server = createServer((_request, response) => {
    fetches++
    if (keysFail) return response.writeHead(500).end()
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(keys))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  keysUrl = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/keys`)
  verify = firebaseVerifier(PROJECT, keysUrl)
})
after(() => server?.close())

const now = () => Math.floor(Date.now() / 1000)

/** A Firebase ID token's claims, as Google writes them for a Google sign-in, with `change`. */
function claims(change: Record<string, unknown> = {}): JWTPayload {
  const claims: JWTPayload = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    auth_time: now() - 60,
    user_id: 'uid-aki',
    sub: 'uid-aki',
    iat: now() - 10,
    exp: now() + 3600,
    email: 'aki@example.com',
    email_verified: true,
    firebase: { identities: { email: ['aki@example.com'] }, sign_in_provider: 'google.com' },
    ...change,
  }
  // A claim set to undefined is left out of the token.
  for (const [name, value] of Object.entries(claims)) if (value === undefined) delete claims[name]
  return claims
}

/** A token signed as Google signs one: RS256, by the key the key server has. */
const token = (change?: Record<string, unknown>, header: Record<string, unknown> = {}) =>
  new SignJWT(claims(change))
    .setProtectedHeader({ alg: 'RS256', kid: KID, ...header })
    .sign(privateKey)

const base64url = (text: string | Uint8Array) => Buffer.from(text).toString('base64url')

/**
 * Rejects with BadToken, for the check named `why`, and nothing in the error holds the token's
 * email.
 */
async function refused(token: string | Promise<string>, why: string) {
  const err = await verify(await token).then(
    () => assert.fail('the token was taken'),
    (err: unknown) => err,
  )
  assert.ok(err instanceof BadToken, inspect(err))
  assert.equal(err.message, why)
  assert.doesNotMatch(inspect(err, { depth: Infinity, showHidden: true }), /aki@example\.com/)
}

test('a token as Google signs one gives its uid, and nothing else from its claims', async () => {
  assert.deepEqual(await verify(await token()), { uid: 'uid-aki' })
})

test('a token for another project is refused: wrong audience, or wrong issuer', async () => {
  await refused(token({ aud: 'another-project' }), 'ERR_JWT_CLAIM_VALIDATION_FAILED (aud)')
  await refused(
    token({ iss: 'https://securetoken.google.com/another-project' }),
    'ERR_JWT_CLAIM_VALIDATION_FAILED (iss)',
  )
  await refused(
    token({ iss: 'https://accounts.google.com' }),
    'ERR_JWT_CLAIM_VALIDATION_FAILED (iss)',
  )
})

test('an expired token is refused, and so is one with no exp', async () => {
  await refused(token({ iat: now() - 7200, exp: now() - 3600 }), 'ERR_JWT_EXPIRED (exp)')
  await refused(token({ exp: now() - CLOCK_TOLERANCE - 2 }), 'ERR_JWT_EXPIRED (exp)')
  await refused(token({ exp: undefined }), 'ERR_JWT_CLAIM_VALIDATION_FAILED (exp)')
})

test('a token issued in the future, or signed in in the future, is refused', async () => {
  await refused(token({ iat: now() + 60 }), 'iat')
  await refused(token({ auth_time: now() + 60 }), 'auth_time')
  await refused(token({ iat: undefined }), 'ERR_JWT_CLAIM_VALIDATION_FAILED (iat)')
  await refused(token({ auth_time: undefined }), 'ERR_JWT_CLAIM_VALIDATION_FAILED (auth_time)')
  await refused(token({ auth_time: 'yesterday' }), 'auth_time')
})

test(`times up to ${CLOCK_TOLERANCE} s ahead of this clock pass, for clocks a little off`, async () => {
  const ahead = now() + CLOCK_TOLERANCE - 2
  assert.deepEqual(await verify(await token({ iat: ahead, auth_time: ahead })), { uid: 'uid-aki' })
  assert.deepEqual(await verify(await token({ exp: now() - CLOCK_TOLERANCE + 2 })), {
    uid: 'uid-aki',
  })
})

test('a token with no sub, an empty one, or one over 128 characters is refused', async () => {
  await refused(token({ sub: undefined }), 'ERR_JWT_CLAIM_VALIDATION_FAILED (sub)')
  await refused(token({ sub: '' }), 'sub')
  await refused(token({ sub: 'a'.repeat(129) }), 'sub')
  await refused(token({ sub: 42 }), 'sub')
  const longest = 'a'.repeat(128)
  assert.deepEqual(await verify(await token({ sub: longest })), { uid: longest })
})

test('HS256 is refused, even signed with the public key as its secret', async () => {
  const hs256 = (secret: Uint8Array) =>
    new SignJWT(claims()).setProtectedHeader({ alg: 'HS256', kid: KID }).sign(secret)
  await refused(hs256(crypto.getRandomValues(new Uint8Array(32))), 'ERR_JOSE_ALG_NOT_ALLOWED')
  // A verifier that takes the alg from the token would check this with the public key's bytes,
  // which anyone can download, as an HMAC secret, and find it good.
  await refused(
    hs256(new TextEncoder().encode(await exportSPKI(publicKey))),
    'ERR_JOSE_ALG_NOT_ALLOWED',
  )
})

test('a token with alg none, so with no signature, is refused', async () => {
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT', kid: KID }))
  await refused(`${header}.${base64url(JSON.stringify(claims()))}.`, 'ERR_JOSE_ALG_NOT_ALLOWED')
})

test('a token signed by a key Google has not published is refused', async () => {
  const other = await generateKeyPair('RS256')
  const sign = (kid: string) =>
    new SignJWT(claims()).setProtectedHeader({ alg: 'RS256', kid }).sign(other.privateKey)
  // An unknown key id, and another key passed off under Google's key id.
  await refused(sign('unknown-key'), 'ERR_JWKS_NO_MATCHING_KEY')
  await refused(sign(KID), 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED')
})

test('a token with a changed claim, or no token at all, is refused', async () => {
  const [header, , signature] = (await token()).split('.')
  await refused(
    `${header}.${base64url(JSON.stringify(claims({ sub: 'uid-rei' })))}.${signature}`,
    'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  )
  for (const text of ['', 'not a token', 'a.b.c']) await refused(text, 'ERR_JWS_INVALID')
})

test("Google's keys are fetched once and kept, even for tokens naming key ids they don't have", async () => {
  const verifier = firebaseVerifier(PROJECT, keysUrl)
  const before = fetches
  for (let i = 0; i < 3; i++) assert.deepEqual(await verifier(await token()), { uid: 'uid-aki' })
  // A key id the keys don't have asks for them again, as for a key Google has just added, but not
  // within 30 s of the last fetch, so that forged key ids can't make the server fetch them on
  // every request.
  for (let i = 0; i < 5; i++)
    await assert.rejects(verifier(await token({}, { kid: `unknown-${i}` })), BadToken)
  assert.equal(fetches - before, 1)
})

test('a server with no Firebase project refuses every token', async () => {
  await assert.rejects(firebaseVerifier(undefined, keysUrl)(await token()), BadToken)
})

test("Google's keys failing is the server's trouble, not a bad token", async (t) => {
  keysFail = true
  t.after(() => (keysFail = false))
  // A new verifier, which has no keys yet and must fetch them.
  const err = await firebaseVerifier(PROJECT, keysUrl)(await token()).catch((err: unknown) => err)
  assert.ok(err instanceof Error && !(err instanceof BadToken), inspect(err))
  assert.match(err.message, /Expected 200 OK/)
})
