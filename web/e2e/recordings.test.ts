import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compare, recordings, requests } from './recordings.ts'

// A recorded browser answers the page only from a recording made for the exact request it sends
// (see Browser.open), so a recording that is missing, or was made for an older query, fails the
// check that needed it, by name, but only once Chrome runs it. Here, each is named offline, and so
// is a recording no check asks for any more.
test('every request the browser checks send AniList has a recording made for it, and no other is kept', async () => {
  assert.deepEqual(
    compare(await requests(), recordings()),
    { missing: [], stale: [], unused: [] },
    'run `npm run e2e:record` in web/: it records the missing and stale ones and deletes the unused',
  )
})
