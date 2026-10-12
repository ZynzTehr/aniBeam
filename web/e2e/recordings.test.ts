import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compare, JUDGED, problems, recordings, requests } from './recordings.ts'

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

// A recording made for today's request can still lack what a check relies on AniList's titles for:
// nine to trend, Frieren first for "frieren", none for "zzqqxx" (see problems()). A check run on
// it would fail, or worse, pass without testing what it says. The recorder writes none like that,
// so here it is one edited by hand, or a rule that has changed since it was recorded.
test('every recording holds what the checks that use it rely on AniList’s titles for', async () => {
  // A rule for a recording no check asks for would judge nothing, so this could never fail on it.
  const wanted = (await requests()).map(({ name }) => name)
  assert.deepEqual(
    JUDGED.filter((name) => !wanted.includes(name)),
    [],
    'rules in problems() for recordings no check asks for, which they never judge',
  )
  assert.deepEqual(
    problems(recordings()),
    [],
    'record them again with `npm run e2e:record -- <names>` in web/; if AniList’s answers can’t hold it any more, the check that relies on it must change, and so must its rule',
  )
})
