import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEV_ORIGIN, loadConfig } from './config.ts'

/** A production environment with every setting it needs, and `change` on top. */
const production = (change: Record<string, string | undefined> = {}) => ({
  NODE_ENV: 'production',
  CORS_ORIGIN: 'https://anibeam.app',
  FIREBASE_PROJECT_ID: 'anibeam',
  ...change,
})

test('a production environment with every setting loads', () => {
  assert.deepEqual(
    loadConfig(production({ CORS_ORIGIN: 'https://anibeam.app, https://www.anibeam.app:8443' })),
    {
      corsOrigins: ['https://anibeam.app', 'https://www.anibeam.app:8443'],
      firebaseProjectId: 'anibeam',
    },
  )
})

test('in production, a missing CORS_ORIGIN stops the start', () => {
  for (const value of [undefined, '', '  '])
    assert.throws(() => loadConfig(production({ CORS_ORIGIN: value })), /CORS_ORIGIN is missing/)
})

test('in production, a CORS_ORIGIN that is not origins stops the start', () => {
  for (const value of [
    'https://anibeam.app/',
    'https://anibeam.app/chat',
    'anibeam.app',
    'HTTPS://ANIBEAM.APP',
    'ftp://anibeam.app',
    // An empty entry, and a bad one after a good one.
    'https://anibeam.app,',
    'https://anibeam.app, anibeam.app',
  ])
    assert.throws(
      () => loadConfig(production({ CORS_ORIGIN: value })),
      /CORS_ORIGIN has ".*", which isn't an origin/,
      value,
    )
})

test('a CORS_ORIGIN with a wildcard stops the start, since no browser sends one', () => {
  for (const value of ['https://*.vercel.app', 'https://anibeam.app, https://*.anibeam.app', '*']) {
    assert.throws(
      () => loadConfig(production({ CORS_ORIGIN: value })),
      /a \* matches no page/,
      value,
    )
    assert.throws(() => loadConfig({ CORS_ORIGIN: value }), /a \* matches no page/, value)
  }
})

test('in production, an http:// CORS_ORIGIN stops the start, but for this computer', () => {
  for (const value of ['http://anibeam.app', 'https://anibeam.app, http://www.anibeam.app:8080'])
    assert.throws(
      () => loadConfig(production({ CORS_ORIGIN: value })),
      /CORS_ORIGIN has "http:\/\/[^"]+", which isn't https:\/\//,
      value,
    )
  assert.deepEqual(
    loadConfig(production({ CORS_ORIGIN: 'http://localhost:5173,http://127.0.0.1:4173' }))
      .corsOrigins,
    ['http://localhost:5173', 'http://127.0.0.1:4173'],
  )
  // Outside production, a page on another computer of the network may be http://.
  assert.deepEqual(loadConfig({ CORS_ORIGIN: 'http://192.168.1.33:5173' }).corsOrigins, [
    'http://192.168.1.33:5173',
  ])
})

test('in production, a missing FIREBASE_PROJECT_ID stops the start', () => {
  for (const value of [undefined, ''])
    assert.throws(
      () => loadConfig(production({ FIREBASE_PROJECT_ID: value })),
      /FIREBASE_PROJECT_ID is missing/,
    )
})

test('in production, FIREBASE_AUTH_EMULATOR_HOST set at all stops the start', () => {
  for (const value of ['127.0.0.1:9099', ''])
    assert.throws(
      () => loadConfig(production({ FIREBASE_AUTH_EMULATOR_HOST: value })),
      /FIREBASE_AUTH_EMULATOR_HOST is set/,
    )
})

test('every problem is named at once, one per line', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' }),
    (err: Error) => {
      assert.equal(err.message.split('\n').length, 4, err.message)
      return true
    },
  )
})

test('outside production, CORS_ORIGIN means the dev server, and no project is needed', () => {
  assert.deepEqual(loadConfig({}), { corsOrigins: [DEV_ORIGIN], firebaseProjectId: undefined })
  assert.deepEqual(
    loadConfig({ NODE_ENV: 'development', FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' }),
    { corsOrigins: [DEV_ORIGIN], firebaseProjectId: undefined },
  )
  // A typo is still a typo.
  assert.throws(() => loadConfig({ CORS_ORIGIN: 'localhost:5173' }), /isn't an origin/)
})
