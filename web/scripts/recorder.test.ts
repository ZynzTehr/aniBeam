import assert from 'node:assert/strict'
import {
  copyFileSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import type { Recording } from '../e2e/browser.ts'
import { compare, FOLDER, recordings, requests } from '../e2e/recordings.ts'
import { record } from './recorder.ts'

// The recorder sends AniList real requests, from a machine whose 30 a minute everything on it
// shares, so its manners matter as much as what it writes: one request at a time, 6.5 s apart; as
// long a wait as AniList asks for; three tries at most; and nothing written that the checks can't
// rely on. A run that goes well shows none of that, and nothing else runs the recorder. So here
// record() runs on stand-ins (see World in recorder.ts): an AniList that answers each request with
// today's recording made for it, unless a test says otherwise; a clock that moves only when the
// recorder waits, so each wait is seen to the millisecond and takes no time; and a copy of
// e2e/anilist/ in a temporary folder.

const wanted = await requests()
const today = recordings()
const PRETTIER = fileURLToPath(new URL('../../.prettierrc.json', import.meta.url))

/** What the stand-in for AniList answers a request with, given the recording made for it. */
type Reply = (recording: Recording) => Response

/** AniList's count of requests left this minute, of the 30 it allows. */
const limit = (left: number) => ({
  'X-RateLimit-Limit': '30',
  'X-RateLimit-Remaining': String(left),
})
/** AniList's answer as recorded, with 29 requests left this minute. */
const answer: Reply = ({ body }) => Response.json(body, { headers: limit(29) })
/** The same answer, as the last request this minute allows. */
const lastThisMinute: Reply = ({ body }) => Response.json(body, { headers: limit(0) })
/** AniList turning a request away as one too many, saying how long to wait, or not. */
const tooMany =
  (retryAfter?: number): Reply =>
  () =>
    Response.json(
      { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] },
      {
        status: 429,
        headers: {
          ...limit(0),
          ...(retryAfter === undefined ? {} : { 'Retry-After': `${retryAfter}` }),
        },
      },
    )
/** AniList down. */
const down: Reply = () =>
  new Response('<html>Service Unavailable</html>', {
    status: 503,
    headers: { 'Content-Type': 'text/html' },
  })
/** No connection to AniList at all. */
const unreachable: Reply = () => {
  throw new TypeError('fetch failed')
}
/** A query AniList turns down, as it would one the app had got wrong. */
const refused: Reply = () =>
  Response.json(
    { data: null, errors: [{ message: 'Cannot query field "x" on type "Media".', status: 400 }] },
    { status: 400, headers: limit(29) },
  )

/** Each JSON file in a folder, and what it holds. */
const filesIn = (folder: string) =>
  new Map(
    readdirSync(folder)
      .filter((file) => file.endsWith('.json'))
      .map((file) => [file, readFileSync(join(folder, file), 'utf8')]),
  )
/** How a folder's files differ from what they were: each one added, deleted or rewritten. */
function changes(before: Map<string, string>, after: Map<string, string>) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .flatMap((file) =>
      !before.has(file)
        ? [`added ${file}`]
        : !after.has(file)
          ? [`deleted ${file}`]
          : before.get(file) !== after.get(file)
            ? [`rewrote ${file}`]
            : [],
    )
}
const TODAY = filesIn(FOLDER)
/**
 * Fails unless anilist/ is up to date. A test that runs the recorder with no names, or with --all,
 * on a copy of it, would otherwise see it record what is out of date there as well, and fail for
 * that, not for the recorder.
 */
function upToDate() {
  assert.deepEqual(
    compare(wanted, today),
    { missing: [], stale: [], unused: [] },
    'anilist/ isn’t up to date (recordings.test.ts says how to bring it up to date), and this test starts from a copy of it',
  )
}

/**
 * Runs the recorder with `args` on the stand-ins: AniList answering its requests with `replies`,
 * one each in turn, then with `answer` once they run out; and a copy of anilist/, which `setUp`
 * may change first. Gives what the run did: its exit code, what it printed, each request it sent
 * (when, and for which recording), and the folder as it left it, with what it changed there.
 */
async function recorder(args: string[], replies: Reply[] = [], setUp?: (folder: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'anibeam-recorder-'))
  const fetch = globalThis.fetch
  let reached = 0
  try {
    // The repo's prettier config above the copy, as it is above anilist/, so that the recorder
    // writes the bytes it would write there.
    copyFileSync(PRETTIER, join(dir, '.prettierrc.json'))
    const folder = join(dir, 'anilist')
    cpSync(FOLDER, folder, { recursive: true })
    setUp?.(folder)
    const before = filesIn(folder)
    // The recorder must ask AniList with the fetch it is handed. Had it reached for the real one,
    // it would have sent AniList a request: this one refuses it, and the test fails.
    globalThis.fetch = async () => {
      reached++
      throw new TypeError('the real fetch, refused by recorder.test.ts')
    }
    let time = 0
    const sent: [number, string][] = []
    let stdout = ''
    let stderr = ''
    const code = await record(args, {
      // Only a request AniList takes, a POST of JSON to its API, gets an answer; any other is
      // noted in full where its recording's name would be, and gets a 404.
      fetch: async (url, init) => {
        const request = JSON.parse(String(init?.body))
        const name = wanted.find((w) => isDeepStrictEqual(w.request, request))?.name ?? ''
        const recording = today.get(name)
        const type = new Headers(init?.headers).get('Content-Type')
        const taken =
          String(url) === 'https://graphql.anilist.co' &&
          init?.method === 'POST' &&
          type === 'application/json'
        sent.push([
          time,
          taken && recording ? name : `${init?.method} ${url} (Content-Type ${type}) ${init?.body}`,
        ])
        if (!taken || !recording) return new Response('Not Found', { status: 404 })
        return (replies.shift() ?? answer)(recording)
      },
      sleep: async (ms) => {
        time += ms
      },
      now: () => time,
      folder,
      stdout: { write: (text) => (stdout += text) },
      stderr: { write: (text) => (stderr += text) },
    })
    assert.equal(
      reached,
      0,
      'the recorder asked AniList with the real fetch, not the one it was handed',
    )
    const after = filesIn(folder)
    return { code, stdout, stderr, sent, after, changed: changes(before, after) }
  } finally {
    globalThis.fetch = fetch
    rmSync(dir, { recursive: true, force: true })
  }
}
type Run = Awaited<ReturnType<typeof recorder>>

/** The requests a run sent, as "trending at 0 s, search-frieren at 6.5 s". */
const schedule = ({ sent }: Run) =>
  sent.map(([ms, name]) => `${name} at ${ms / 1000} s`).join(', ') || 'none'
/** Fails unless a run sent its requests as `expected` says, naming the rule they break if not. */
function sentAsExpected(run: Run, expected: string, rule: string) {
  assert.equal(schedule(run), expected, `${rule}; it sent ${schedule(run)}, not ${expected}`)
}
/** The line a run printed that starts with `start`. */
const lineOf = ({ stdout }: Run, start: string) =>
  stdout.split('\n').find((line) => line.startsWith(start)) ?? `no line starting "${start}"`
/** Fails unless a run went on to the end: exit 0, having said nothing of stopping. */
function finished(run: Run) {
  assert.ok(run.code === 0 && !run.stderr, `the run stopped (exit ${run.code}): ${run.stderr}`)
}
/** Fails unless a run stopped, saying `why`, with the folder as it found it. */
function stoppedSaying(run: Run, why: RegExp | string) {
  const said = run.stderr.replace(/^\nNothing written: /, '')
  assert.ok(
    run.code === 1 &&
      run.stderr.startsWith('\nNothing written: ') &&
      (typeof why === 'string' ? said === `${why}\n` : why.test(said)),
    `the run must stop (exit 1), saying "Nothing written: ${why}"; it ended with exit ${run.code}, saying ${JSON.stringify(run.stderr)}`,
  )
  assert.deepEqual(run.changed, [], 'a run that stops must leave the folder as it found it')
}

test('the recorder asks AniList one request at a time, 6.5 s apart', async () => {
  const run = await recorder(['trending', 'search-frieren', 'search-naruto'])
  sentAsExpected(
    run,
    'trending at 0 s, search-frieren at 6.5 s, search-naruto at 13 s',
    'requests go out one at a time, at least 6.5 s apart, so never more than 10 in a minute',
  )
  finished(run)
})

test('after a 429 it waits as long as Retry-After says and a second more, or a whole minute when AniList doesn’t say', async () => {
  const told = await recorder(['trending', 'search-frieren'], [tooMany(30)])
  sentAsExpected(
    told,
    'trending at 0 s, trending at 31 s, search-frieren at 37.5 s',
    'a 429 saying Retry-After: 30 is asked again 31 s later, and the next request waits its 6.5 s after that',
  )
  assert.ok(
    lineOf(told, 'trending:').startsWith(
      'trending: AniList answered 429, asking again in 31 s; 200, 29 of 30 left this minute;',
    ),
    `trending's line must say why it waits, and how long: ${lineOf(told, 'trending:')}`,
  )
  finished(told)
  const untold = await recorder(['trending'], [tooMany()])
  sentAsExpected(
    untold,
    'trending at 0 s, trending at 60 s',
    'a 429 with no Retry-After is asked again a whole minute later, as AniList’s timeout lasts',
  )
  finished(untold)
})

test('after a 5xx it asks again 10 s later, and after a failed connection a minute later, and keeps the answer that comes', async () => {
  const server = await recorder(['trending'], [down])
  sentAsExpected(server, 'trending at 0 s, trending at 10 s', 'a 503 is asked again 10 s later')
  assert.ok(
    lineOf(server, 'trending:').startsWith(
      'trending: AniList answered 503, asking again in 10 s; 200, 29 of 30 left this minute;',
    ),
    `trending's line must say why it waits, and how long: ${lineOf(server, 'trending:')}`,
  )
  finished(server)
  const connection = await recorder(['trending'], [unreachable])
  sentAsExpected(
    connection,
    'trending at 0 s, trending at 60 s',
    'a request that never reached AniList is asked again a minute later',
  )
  finished(connection)
})

test('three tries that fail in a row stop the run, with nothing written', async () => {
  // With trending's recording gone, a run that went on would write one.
  const run = await recorder(['trending', 'search-frieren'], [down, down, down], (folder) =>
    rmSync(join(folder, 'trending.json')),
  )
  sentAsExpected(
    run,
    'trending at 0 s, trending at 10 s, trending at 20 s',
    'a request is tried 3 times, and no more',
  )
  stoppedSaying(run, 'AniList answered 503, 3 times in a row')
})

test('an answer that says none are left this minute makes the next request wait the minute out', async () => {
  const run = await recorder(['trending', 'search-frieren'], [lastThisMinute])
  sentAsExpected(
    run,
    'trending at 0 s, search-frieren at 61 s',
    'after a 200 with X-RateLimit-Remaining: 0, the next request waits 61 s, as the app does',
  )
  finished(run)
})

// The 1980s opening on the 1990s' first title breaks a rule only beside the 1990s' recordings, so
// the recorder can't tell from the answer alone, and judges the folder as it would be at the end.
test('answers that break a rule only beside the other recordings write nothing, and delete nothing', async () => {
  const ninetiesFirst = today.get('first-visit')!.body.data.era.media[0]
  const opensOnTheNineties: Reply = ({ body }) => {
    const copy = structuredClone(body)
    copy.data.Page.media[0] = ninetiesFirst
    return Response.json(copy, { headers: limit(29) })
  }
  // With a recording no check asks for, which a run that went on would delete.
  const run = await recorder(['era-1980s'], [opensOnTheNineties], (folder) =>
    writeFileSync(join(folder, 'search-old-term.json'), TODAY.get('search-zzqqxx.json')!),
  )
  sentAsExpected(run, 'era-1980s at 0 s', 'one request, for the one recording named')
  stoppedSaying(
    run,
    /^these recordings would lack what the checks rely on:\nera-1980s needs a first title other than the 1990s' first, .*; it opens on '.+', as first-visit's era does\.\n$/,
  )
})

test('an answer that can’t be kept stops the run at once, before the next request', async () => {
  const run = await recorder(['trending', 'search-frieren', 'search-naruto'], [refused])
  sentAsExpected(
    run,
    'trending at 0 s',
    'after an answer that can’t be kept, AniList is asked nothing more',
  )
  stoppedSaying(
    run,
    /^trending needs to be a 200 with no errors and a list of titles for each list asked for, .*; AniList answered 400 with errors: .*Cannot query field/,
  )
})

test('a recording no check asks for is deleted', async () => {
  upToDate()
  const run = await recorder([], [], (folder) =>
    writeFileSync(join(folder, 'search-old-term.json'), TODAY.get('search-zzqqxx.json')!),
  )
  sentAsExpected(run, 'none', 'with nothing missing or stale, nothing is asked')
  finished(run)
  assert.deepEqual(
    run.changed,
    ['deleted search-old-term.json'],
    'what the run changed in the folder, where it had one recording no check asks for',
  )
  assert.equal(
    lineOf(run, 'Recording'),
    `Recording 0 of ${wanted.length}, and deleting 1 no check asks for.`,
  )
})

test('--all records every one again, and an unchanged answer keeps its file as it was', async () => {
  upToDate()
  const run = await recorder(['--all'])
  sentAsExpected(
    run,
    wanted.map(({ name }, i) => `${name} at ${(i * 6_500) / 1000} s`).join(', '),
    '--all asks for every recording, 6.5 s apart',
  )
  finished(run)
  assert.deepEqual(run.changed, [], 'files rewritten for answers that hadn’t changed')
  assert.equal(
    lineOf(run, 'Wrote').replace(/ in .*/, ''),
    'Wrote 0 and deleted 0',
    `answers that hadn’t changed were counted as written: ${lineOf(run, 'Wrote')}`,
  )
})

test('by default it records the missing and stale recordings, written as `npm run format` would leave them', async () => {
  upToDate()
  const run = await recorder([], [], (folder) => {
    rmSync(join(folder, 'search-frieren.json'))
    // As if recorded before the app asked for banners.
    const nar = JSON.parse(TODAY.get('search-nar.json')!)
    nar.request.query = nar.request.query.replace(' bannerImage', '')
    writeFileSync(join(folder, 'search-nar.json'), JSON.stringify(nar, null, 2))
  })
  sentAsExpected(
    run,
    'search-frieren at 0 s, search-nar at 6.5 s',
    'a run with no arguments asks for the missing and stale recordings, and no others',
  )
  finished(run)
  assert.deepEqual(
    changes(TODAY, run.after),
    [],
    'files that differ from today’s anilist/, recorded from the same answers',
  )
})

test('an option other than --all, or a name no check sends, stops the run before it asks AniList anything', async () => {
  const option = await recorder(['--al'])
  sentAsExpected(option, 'none', 'an option it doesn’t know sends nothing')
  stoppedSaying(option, 'the only option is --all, not --al')
  const name = await recorder(['search-frieren', 'search-nope'])
  sentAsExpected(name, 'none', 'a name no check sends sends nothing')
  stoppedSaying(name, /^no request is named search-nope\. The names: first-visit, trending, /)
})
