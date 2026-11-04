import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guard, GUARDED } from './fetch-guard.ts'

// The guard's own test sends nothing to the network, even with the guard broken: the addresses
// it refuses go to a fetch of this file's, which only notes them.

test("the guard refuses every address but this computer's, before anything is fetched", async () => {
  const fetched: string[] = []
  const guarded = guard(async (input) => {
    fetched.push(String(input))
    return new Response('{}')
  })
  for (const url of [
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
    'https://securetoken.google.com/anibeam',
    'https://graphql.anilist.co/',
    'http://0.0.0.0:1/',
  ])
    await assert.rejects(guarded(url), /The server's tests reach nothing on the network/, url)
  assert.deepEqual(fetched, [])
  const local = ['http://127.0.0.1:1/', 'http://localhost:1/', 'http://[::1]:1/']
  for (const url of local) await guarded(url)
  assert.deepEqual(fetched, local)
})

test("every test file's fetch is the guard (npm test's --import)", async () => {
  // Checked first, so that without the guard nothing is fetched.
  assert.equal((fetch as unknown as Record<symbol, unknown>)[GUARDED], true, 'no fetch guard')
  // 0.0.0.0 is this computer to Node but not to the guard, so a guard that let it through would
  // fail here on a refused connection, not reach anything.
  await assert.rejects(
    fetch('http://0.0.0.0:1/'),
    /The server's tests reach nothing on the network/,
  )
})
