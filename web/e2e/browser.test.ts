import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromeArgs, sessionWindow } from './browser.ts'

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

// Layout shift is counted as web-vitals counts CLS: shifts within 500 ms of the visitor's input
// (Chrome marks them hadRecentInput) are left out, the rest fall into session windows, each a run
// of shifts less than 1 s apart and at most 5 s long, and the page's score is its largest window's.
test('layout shifts count in session windows, the largest one the score, and shifts after input left out', () => {
  const at = (time: number, value: number, input = false) => ({ time, value, input })
  // Scores to 6 places, as adding them up in floating point can leave a speck.
  const score = (shifts: ReturnType<typeof at>[]) =>
    Math.round(sessionWindow(shifts).value * 1e6) / 1e6
  assert.equal(score([]), 0, 'no shifts')
  // Two windows: 0.1 + 0.05 at 0 and 0.9 s, then 0.12 after a gap of 1 s; the larger counts.
  assert.equal(score([at(0, 0.1), at(900, 0.05), at(1900, 0.12)]), 0.15)
  // A shift right after input is the visitor's doing.
  assert.equal(score([at(0, 0.3, true), at(100, 0.02)]), 0.02)
  // A window ends 5 s after it began, however close its shifts.
  const steady = [0, 800, 1600, 2400, 3200, 4000, 4800, 5600].map((time) => at(time, 0.01))
  assert.equal(score(steady), 0.07)
  // The shifts of the window that counts, for messages.
  assert.deepEqual(
    sessionWindow([at(0, 0.01), at(2000, 0.2), at(2500, 0.01)]).shifts.map(({ time }) => time),
    [2000, 2500],
  )
})
