import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BadToken, firebaseVerifier } from '../auth/verify.ts'
import { devVerifier } from './verify.ts'

test('the dev sign-in takes dev:<name> as the uid dev:<name>', async () => {
  for (const token of ['dev:aki', 'dev:Aki', 'dev:a', 'dev:rei_2', `dev:${'a'.repeat(20)}`])
    assert.deepEqual(await devVerifier(token), { uid: token })
})

test('the dev sign-in refuses anything else', async () => {
  for (const token of [
    '',
    'aki',
    'dev:',
    'DEV:aki',
    'Bearer dev:aki',
    'dev:a b',
    'dev:äki',
    'dev:aki\n',
    `dev:${'a'.repeat(21)}`,
  ])
    await assert.rejects(devVerifier(token), BadToken, JSON.stringify(token))
})

test('the production verifier refuses a dev: token as a bad token', async () => {
  // dev:aki isn't a JWT, so it is refused before any key is fetched; nothing listens on port 1.
  const verify = firebaseVerifier('anibeam-test', new URL('http://127.0.0.1:1/keys'))
  for (const token of ['dev:aki', 'dev:rei_2'])
    await assert.rejects(verify(token), { name: 'BadToken', message: 'ERR_JWS_INVALID' }, token)
})
