import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromeArgs, GOOGLE, poll, sessionWindow } from './browser.ts'

// The addresses Chrome is started unable to resolve: those its --host-resolver-rules map to
// ~NOTFOUND, one rule each, as Chrome reads them, comma-separated.
const unresolved = (args: string[]) =>
  args
    .filter((arg) => arg.startsWith('--host-resolver-rules='))
    .flatMap((arg) => arg.slice('--host-resolver-rules='.length).split(','))
    .map((rule) => /^\s*MAP (\S+) ~NOTFOUND\s*$/.exec(rule)?.[1] ?? `unread: ${rule}`)

// The live checks are the only ones to see AniList's API, and when Chrome can't reach AniList they
// skip, saying it's not the app, as they should while it is down. So a live browser started with a
// recorded one's rule against resolving AniList's address would have them skip on every run, while
// the run passes; and a check in Chrome could only tell by sending AniList a request. Here, the
// arguments Chrome starts with are read offline instead: the rule is a recorded browser's alone,
// and in all else a live browser's Chrome starts as a recorded one's does.
test('only a recorded browser starts Chrome unable to resolve AniList’s address, and a live one differs from it in that alone', () => {
  const recorded = chromeArgs('recorded', 'profile')
  const live = chromeArgs('live', 'profile')
  const namingAniList = (args: string[]) => unresolved(args).filter((host) => /anilist/i.test(host))
  assert.deepEqual(
    { recorded: namingAniList(recorded), live: namingAniList(live) },
    { recorded: ['graphql.anilist.co'], live: [] },
    'the AniList addresses each browser’s Chrome starts unable to resolve',
  )
  assert.deepEqual(
    unresolved(live),
    unresolved(recorded).filter((host) => !/anilist/i.test(host)),
    'the addresses a live browser’s Chrome can’t resolve, beside a recorded one’s but AniList’s',
  )
  assert.deepEqual(
    live.filter((arg) => !arg.startsWith('--host-resolver-rules=')),
    recorded.filter((arg) => !arg.startsWith('--host-resolver-rules=')),
    'a live browser’s other Chrome arguments, beside a recorded one’s',
  )
})

// Spec §5: YouTube loads only when a trailer is played, and the checks that press "Watch trailer"
// must play none. So no browser's Chrome, live or recorded, can resolve YouTube's or Google's
// addresses, nor any under them: a frame or image from them fails before it leaves the machine,
// and the checks still see what the page asked for (see Browser.watchRequests).
test('every browser starts Chrome unable to resolve YouTube’s and Google’s addresses, and those under them', () => {
  for (const mode of ['recorded', 'live'] as const) {
    const hosts = unresolved(chromeArgs(mode, 'profile'))
    assert.deepEqual(
      ['youtube-nocookie.com', 'youtube.com', 'ytimg.com'].filter((host) => !GOOGLE.includes(host)),
      [],
      'GOOGLE leaves out the trailer’s own addresses',
    )
    assert.deepEqual(
      GOOGLE.flatMap((host) => [host, `*.${host}`]).filter((host) => !hosts.includes(host)),
      [],
      `a ${mode} browser’s Chrome can resolve these`,
    )
    assert.deepEqual(
      hosts.filter((host) => host.startsWith('unread')),
      [],
      `rules a ${mode} browser’s Chrome would read some other way`,
    )
  }
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

// A check that waits for the page (waitFor) asks again as its document is replaced: Chrome drops a
// question under way as a reload or a navigation takes the old document away, answering it with an
// error, and a check that took that for a failure failed at random on a reload (list.e2e.ts's, 2 of
// 7 runs). Any other error still fails it at once.
test('waitFor asks again when a reload takes away the document it was asking, and fails on any other error', async () => {
  const answers: (boolean | Error)[] = [
    new Error('Runtime.evaluate: Inspected target navigated or closed'),
    new Error('Runtime.evaluate: Cannot find context with specified id'),
    false,
    true,
  ]
  let asked = 0
  const check = async () => {
    const answer = answers[asked++]
    if (answer instanceof Error) throw answer
    return answer
  }
  assert.equal(await poll(check, 5000), true, 'its answer once the new document is there')
  assert.equal(asked, 4, 'how many times it asked')
  await assert.rejects(
    poll(async () => {
      throw new Error('Runtime.evaluate: ReferenceError: nowhere is not defined')
    }, 5000),
    /ReferenceError/,
  )
})
