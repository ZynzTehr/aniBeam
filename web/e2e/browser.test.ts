import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromeArgs } from './browser.ts'

// The live checks are the only ones to see AniList's API, and when Chrome can't reach AniList they
// skip, saying it's not the app, as they should while it is down. So a live browser started with a
// recorded one's rule against resolving AniList's address would have them skip on every run, while
// the run passes; and a check in Chrome could only tell by sending AniList a request. Here, the
// arguments Chrome starts with are read offline instead: the rule is a recorded browser's alone,
// and in all else a live browser's Chrome starts as a recorded one's does.
test('only a recorded browser starts Chrome unable to resolve AniList’s address, and a live one differs from it in that alone', () => {
  const recorded = chromeArgs('recorded', 'profile')
  const live = chromeArgs('live', 'profile')
  const namingAniList = (args: string[]) => args.filter((arg) => /anilist/i.test(arg))
  assert.deepEqual(
    { recorded: namingAniList(recorded), live: namingAniList(live) },
    { recorded: ['--host-resolver-rules=MAP graphql.anilist.co ~NOTFOUND'], live: [] },
    'the arguments naming AniList that each browser’s Chrome starts with',
  )
  assert.deepEqual(
    live,
    recorded.filter((arg) => !/anilist/i.test(arg)),
    'a live browser’s Chrome arguments, beside a recorded one’s without its rule for AniList',
  )
})
