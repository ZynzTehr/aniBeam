import assert from 'node:assert/strict'
import { test } from 'node:test'

// The guard is loaded by npm test's --import, not imported here, so this checks the run's setup.
const GUARDED = Symbol.for('anibeam.no-network')

test("the tests' fetch reaches nothing on the network, such as Google's key server", async () => {
  // Checked first, so that without the guard nothing is fetched.
  assert.equal((fetch as unknown as Record<symbol, unknown>)[GUARDED], true, 'no fetch guard')
  for (const url of [
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
    'https://securetoken.google.com/anibeam',
    'https://graphql.anilist.co/',
  ])
    await assert.rejects(fetch(url), /The server's tests reach nothing on the network/, url)
})
