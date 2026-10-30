// The browser helper itself: a Chrome that fails to start leaves nothing behind, a browser answers
// AniList from recordings of its answers unless asked for AniList's own, and a recorded browser
// gives the page those, and sends AniList nothing. And press() presses keys as a keyboard does.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { titleOf } from '../src/features/anime/format.ts'
import { ERAS, FIRST_ERA, QUERIES, type Media } from '../src/features/anime/queries.ts'
import { SAMPLES } from '../src/features/anime/samples.ts'
import { Browser, type AniListMode, type Recording } from './browser.ts'

const profiles = () => readdirSync(tmpdir()).filter((name) => name.startsWith('anibeam-e2e-'))

test('a Chrome that exits at once fails fast and leaves no profile behind', async () => {
  // The system temp folder holds the profile of every Chrome the other test files run meanwhile,
  // made and removed as they go, so this one makes its profile in a temp folder of its own.
  const tmp = process.env.TMPDIR
  const own = mkdtempSync(join(tmpdir(), 'anibeam-tmp-'))
  process.env.TMPDIR = own
  const chromeBin = process.env.CHROME_BIN
  process.env.CHROME_BIN = '/usr/bin/false' // starts, then exits straight away
  try {
    const started = Date.now()
    await assert.rejects(Browser.open(), /exited before it was ready/)
    assert.ok(Date.now() - started < 5_000, 'it waited for a browser that had already exited')
    assert.deepEqual(profiles(), [], 'its profile folder was left behind')
  } finally {
    // The checks below start a real Chrome, in the system temp folder.
    if (chromeBin === undefined) delete process.env.CHROME_BIN
    else process.env.CHROME_BIN = chromeBin
    if (tmp === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = tmp
    rmSync(own, { recursive: true, force: true })
  }
})

// Real AniList answers, made from the bundled sample titles, renamed so the samples can't pass
// for them: a page that can't get its answer shows the samples instead.
const renamed = (titles: Media[], name: string): Media[] =>
  titles.map((media, i) => ({
    ...media,
    title: { romaji: `${name} ${i + 1}`, english: null, native: null },
  }))
const trending = renamed(SAMPLES.slice(0, 20), 'Recorded trending title')
const nineties = renamed(SAMPLES.slice(20), 'Recorded 1990s title')
const found = renamed(SAMPLES.slice(0, 5), 'Recorded result')
// The one request a first visit sends, for trending and the 1990s, as the app makes it (see
// bothLists in queries.ts), and a search's.
const firstVisit: Recording = {
  request: { query: QUERIES.firstVisit, variables: FIRST_ERA.variables },
  status: 200,
  body: { data: { trending: { media: trending }, era: { media: nineties } } },
}
const recordedSearch: Recording = {
  request: { query: QUERIES.search, variables: { search: 'recorded search' } },
  status: 200,
  body: { data: { Page: { media: found } } },
}
// A copy of the recorded search under another term, as if recorded while the search's query asked
// for one more field.
const olderSearch: Recording = {
  ...recordedSearch,
  request: {
    query: QUERIES.search.replace('{ id ', '{ id description '),
    variables: { search: 'zzqq older query' },
  },
}
// An AniList answer of HTTP 400, as discover.e2e.ts stages a search turned down.
const BAD_REQUEST = {
  status: 400,
  body: { data: null, errors: [{ message: 'Bad request', status: 400 }] },
}

// What the visitor sees: the trending heading, the panels' titles, the decade strip's and both
// sections' status lines.
const shown = `({
  heading: document.getElementById('ab-trending').firstChild.textContent,
  panels: [...document.querySelectorAll('.ab-grid .ab-caption b')].map((title) => title.textContent),
  strip: [...document.querySelectorAll('.ab-strip-row .ab-strip-title')].map((title) => title.textContent),
  notes: [...document.querySelectorAll('.ab-note')].map((note) => note.textContent),
})`
type Shown = { heading: string; panels: string[]; strip: string[]; notes: string[] }
// How long each of the page's answered requests to AniList took, in ms, from its fetch to the end
// of the answer (Resource Timing: a request that failed has no entry).
const answered = `performance.getEntriesByType('resource').filter((entry) => entry.name.startsWith('https://graphql.anilist.co')).map((entry) => Math.round(entry.duration))`
// The search results' titles, joined; and whether they offer Try again for this search.
const resultTitles = `[...document.querySelectorAll('.ab-results .ab-strip-panel[href] .ab-strip-title')].map((t) => t.textContent).join(' | ')`
const retryFor = (term: string) =>
  `document.querySelector('#results')?.textContent.includes(${JSON.stringify(`“${term}”`)}) && document.querySelector('.ab-results .ab-retry')`

/**
 * Searches for `text` as a paste does, in one input event, so the page never searches part of it:
 * a recorded browser has no answer for that.
 */
async function paste(browser: Browser, text: string) {
  await browser.evaluate(
    `(() => { const input = document.querySelector('.ab-search textarea'); input.focus(); input.select(); return true })()`,
  )
  await browser.send('Input.insertText', { text })
}

/** What a promise was rejected with, or null if it wasn't. */
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: Error) => error.message,
  )

// A browser whose check doesn't choose answers AniList from the recordings in anilist/, so a run
// sends AniList's API nothing unless asked to. ANILIST=live asks for AniList's own answers in
// every such browser, and ANILIST=off allows no live browser at all, even one a check asks for.
// This check sets or unsets ANILIST for each case and puts it back after, so it passes in a live
// run too, and the checks after it run as they would have.
test('a browser answers from the recordings unless a check or ANILIST asks for live answers, ANILIST=off allows no live browser, and any other ANILIST throws', async () => {
  const anilist = process.env.ANILIST
  const setAniList = (value: string | undefined) => {
    if (value === undefined) delete process.env.ANILIST
    else process.env.ANILIST = value
  }
  // Where a browser's answers come from with ANILIST at `value`, when its check asks for
  // `aniList` or for nothing; or what open() throws instead. None of them loads the app, so even
  // a live one sends AniList nothing.
  const opens = async (value: string | undefined, aniList?: AniListMode) => {
    setAniList(value)
    try {
      const browser = await Browser.open({ aniList })
      await browser.close()
      return browser.aniList
    } catch (error) {
      return `throws: ${(error as Error).message}`
    }
  }
  try {
    assert.deepEqual(
      {
        'ANILIST unset': await opens(undefined),
        'ANILIST=recorded': await opens('recorded'),
        'ANILIST=live': await opens('live'),
        'ANILIST=off': await opens('off'),
        'ANILIST unset, the check asks for live': await opens(undefined, 'live'),
        'ANILIST=live, the check asks for recorded': await opens('live', 'recorded'),
        'ANILIST=off, the check asks for live': await opens('off', 'live'),
        'ANILIST=Live': await opens('Live'),
      },
      {
        'ANILIST unset': 'recorded',
        'ANILIST=recorded': 'recorded',
        'ANILIST=live': 'live',
        'ANILIST=off': 'recorded',
        'ANILIST unset, the check asks for live': 'live',
        'ANILIST=live, the check asks for recorded': 'recorded',
        'ANILIST=off, the check asks for live':
          "throws: ANILIST=off allows no live browser, so that AniList's API gets nothing, but a check asked for one: run it without ANILIST=off, or have it skip under off.",
        'ANILIST=Live':
          'throws: ANILIST is "Live", but it can only be recorded (the default), live or off.',
      },
      'where each browser’s AniList answers came from',
    )

    // So a plain browser answers a first visit from first-visit.json, and can't reach AniList: a
    // request that got past the recordings would fail to resolve its address (see the last check).
    setAniList(undefined)
    const recorded: Recording = JSON.parse(
      readFileSync(new URL('./anilist/first-visit.json', import.meta.url), 'utf8'),
    )
    const browser = await Browser.open()
    try {
      await browser.load()
      const titles = await browser.titlesShown(15_000)
      const { heading, panels, notes } = await browser.evaluate<Shown>(shown)
      assert.ok(titles, 'no titles came, not even the samples')
      assert.deepEqual(
        { heading, panels, notes },
        {
          heading: 'Trending now',
          panels: recorded.body.data.trending.media.slice(0, 9).map(titleOf),
          notes: ['', ''],
        },
        'a plain browser did not show first-visit.json’s titles, with quiet status lines',
      )
      await browser.send('Fetch.disable')
      const { errorText } = await browser.send('Page.navigate', {
        url: 'https://graphql.anilist.co/',
      })
      assert.equal(
        errorText,
        'net::ERR_NAME_NOT_RESOLVED',
        'AniList’s address resolved in a plain browser',
      )
    } finally {
      await browser.close()
    }
  } finally {
    setAniList(anilist)
  }
})

// AniList's address doesn't resolve in a recorded browser (see the last check), so a request, or
// the CORS preflight Chrome sends before it, that got past the recordings would fail, and the page
// would show its samples: the recorded titles show only if both were answered here.
test('a browser opened with recordings shows their titles, answered a moment later as AniList answers, and sends AniList nothing', async () => {
  const browser = await Browser.open({ aniList: 'recorded', recordings: [firstVisit] })
  try {
    await browser.load()
    const titles = await browser.titlesShown(15_000)
    const page = await browser.evaluate<Shown>(shown)
    const took = await browser.evaluate<number[]>(answered)
    assert.ok(titles, 'no titles came, not even the samples')
    assert.deepEqual(
      page,
      {
        heading: 'Trending now',
        panels: trending.slice(0, 9).map(titleOf),
        strip: nineties.map(titleOf),
        notes: ['', ''],
      },
      'the page did not show the recorded titles, with quiet status lines',
    )
    assert.equal(took.length, 1, 'the page’s requests to AniList that were answered')
    // AniList takes about 230 ms, and the checks were made against that: some look at the page
    // while a request is out, and some give an answer only a few seconds to come.
    assert.ok(
      took[0] >= 150 && took[0] < 1_000,
      `the recorded answer came ${took[0]} ms after the page asked`,
    )
  } finally {
    await browser.close()
  }
})

test('in a recorded browser, a request with no recording fails the check waiting on it, naming it and what to do about it, unless a rewrite answers it', async () => {
  const browser = await Browser.open({
    aniList: 'recorded',
    recordings: [firstVisit, recordedSearch, olderSearch],
  })
  // Whether a failure names the search with no recording, and says how to record it: list it in
  // recordings.ts, then run the recorder. And that the search may have gone out mid-word, only
  // when it is the start of a recorded one.
  const missed = (message: string | null, term: string, midWord = false) =>
    !!message?.startsWith(
      `The page asked AniList for SEARCH_MATCH with {"search":"${term}"}, which has no recording among the ones the check gave Browser.open().`,
    ) &&
    message.includes('web/e2e/recordings.ts') &&
    message.includes('npm run e2e:record') &&
    message.includes('mid-word') === midWord
  // What a failure says to do about a request with no recording, once it has named it.
  const advice = (message: string | null) =>
    message?.split('which has no recording among the ones the check gave Browser.open(). ')[1] ??
    message
  // What waiting throws once the page has asked AniList for `request` with a fetch of its own,
  // sent as the app sends its requests (see anilist() in src/lib/anilist.ts).
  const asked = async (request: Recording['request']) => {
    await browser.evaluate(
      `fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: ${JSON.stringify(JSON.stringify(request))} }).then(() => true)`,
    )
    return failure(browser.waitFor('true', 1_000))
  }
  const era = (id: string) => ERAS.find((each) => each.id === id)!.variables
  let closed = false
  try {
    // The profile open() made for this browser's Chrome, and the port that Chrome noted there for
    // DevTools requests: once the browser has closed, at the end, nothing may answer on that port,
    // and the profile must be gone. The browser names its profile: a new one in the temp folder
    // could be another run's, starting a Chrome of its own on this machine at the same time.
    const port = readFileSync(join(browser.profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]
    await browser.load()
    assert.ok(await browser.titlesShown(15_000), 'no titles came, not even the samples')
    // A recorded search shows its titles, so a key that left the term out would answer the
    // searches below with them.
    await paste(browser, 'recorded search')
    assert.ok(
      await browser.waitFor(
        `${resultTitles} === ${JSON.stringify(found.map(titleOf).join(' | '))}`,
      ),
      'the recorded search’s titles never came',
    )
    // A search that is the start of a recorded one may have gone out mid-word, on a machine too
    // busy to type in time, where a rerun needs no recording: the failure says so.
    await paste(browser, 'recorded sea')
    const midWord = await failure(browser.waitFor(retryFor('recorded sea'), 10_000))
    assert.ok(
      missed(midWord, 'recorded sea', true),
      `waiting on a search that starts a recorded one: ${midWord}`,
    )
    // The page gets a 404 for a search with no recording, and offers Try again: waiting for
    // that throws, naming the search.
    await paste(browser, 'zzqq no recording')
    const unrecorded = await failure(browser.waitFor(retryFor('zzqq no recording'), 10_000))
    assert.ok(
      missed(unrecorded, 'zzqq no recording'),
      `waiting on a search with no recording: ${unrecorded}`,
    )
    // A recording made for an older query text answers nothing, as an answer to another query may
    // lack a field the page asks for now: a search for olderSearch's term has no recording. A key
    // that left the query text out would answer it with olderSearch's titles.
    await paste(browser, 'zzqq older query')
    const olderQuery = await failure(browser.waitFor(retryFor('zzqq older query'), 10_000))
    assert.ok(
      missed(olderQuery, 'zzqq older query'),
      `waiting on a search recorded only for an older query: ${olderQuery}`,
    )
    // A rewrite that passes every answer on, as a check can for all of its file's, can't hide one.
    await browser.rewriteAniList(({ status, body }) => ({ status, body }))
    await paste(browser, 'zzqq passed on')
    const passedOn = await failure(browser.waitFor(retryFor('zzqq passed on'), 10_000))
    assert.ok(
      missed(passedOn, 'zzqq passed on'),
      `waiting on a search with no recording, its 404 passed on by a rewrite: ${passedOn}`,
    )
    // A rewrite that answers with another status needs no recording, as with a search turned down.
    await browser.rewriteAniList(({ request }) => (request.variables.search ? BAD_REQUEST : null))
    await paste(browser, 'zzqq turned down')
    assert.equal(
      await failure(browser.waitFor(retryFor('zzqq turned down'), 10_000)),
      null,
      'waiting on a search with no recording that a rewrite answered',
    )
    // A search typed with search() can go out mid-word, on a machine too busy to type in time.
    // The start of it then has no recording, and needs none, as a rerun sends the whole search:
    // so the failure says to run the check again, and nothing about recording. The whole search
    // still needs one. The text has capitals, which the page searches for in lower case, and
    // each search on the way to it is turned down, so none fails this check if it goes out.
    await browser.rewriteAniList(({ request }) => {
      const { search } = request.variables
      return typeof search === 'string' && search !== 'zzqq typed' ? BAD_REQUEST : null
    })
    await browser.search('Zzqq Typed')
    const typed = await failure(browser.waitFor(retryFor('Zzqq Typed'), 10_000))
    await browser.rewriteAniList(null)
    // As if the page had searched before the last letters went in.
    await paste(browser, 'Zzqq Ty')
    const cutShort = await failure(browser.waitFor(retryFor('Zzqq Ty'), 10_000))
    // recordings.ts lists the searches, decades, titles and My List's titles the checks send, and
    // always asks for trending and a first visit. A request of any other kind, such as another
    // query for a title, or for another list sorted as the decades are, has to be added to its
    // requests() instead.
    const decade = await asked({ query: QUERIES.era, variables: era('2000s') })
    const trendingAlone = await asked({ query: QUERIES.trending, variables: {} })
    const anotherFirstVisit = await asked({ query: QUERIES.firstVisit, variables: era('1980s') })
    const title = await asked({
      query: 'query ($id: Int) { Media(id: $id) { id } }',
      variables: { id: 1 },
    })
    const titleAlone = await asked({ query: QUERIES.title, variables: { id: 1 } })
    const myList = await asked({ query: QUERIES.list, variables: { ids: [1, 2] } })
    const anotherList = await asked({
      query:
        'query ($genre: String) { Page(perPage: 20) { media(type: ANIME, sort: POPULARITY_DESC, genre: $genre) { id } } }',
      variables: { genre: 'Drama' },
    })
    const newKind =
      'It is not a search, a decade, a title on its own, My List’s titles, trending or a first visit: to record it, add it to requests() in web/e2e/recordings.ts unless it is there already, then run `npm run e2e:record` in web/.'
    const record =
      'To record it, add it to SEARCHES or DECADES in web/e2e/recordings.ts unless it is there already, then run `npm run e2e:record` in web/.'
    assert.deepEqual(
      {
        'a search typed in full': advice(typed),
        'the start of it, as if it went out mid-word': advice(cutShort),
        'a decade': advice(decade),
        'trending on its own': advice(trendingAlone),
        'a first visit with another decade': advice(anotherFirstVisit),
        'another query for a title': advice(title),
        'a title on its own': advice(titleAlone),
        'My List’s titles': advice(myList),
        'another list, sorted as the decades are': advice(anotherList),
      },
      {
        'a search typed in full': record,
        'the start of it, as if it went out mid-word':
          'It is the start of "Zzqq Typed", which the check typed with Browser.search(), so it went out mid-word, on a machine too busy to type in time, and needs no recording: run the check again.',
        'a decade': record,
        'trending on its own': record,
        'a first visit with another decade': record,
        'another query for a title': newKind,
        'a title on its own':
          'To record it, add its id to TITLES in web/e2e/recordings.ts unless it is there already, then run `npm run e2e:record` in web/.',
        'My List’s titles':
          'To record it, add its ids to LISTS in web/e2e/recordings.ts unless they are there already, then run `npm run e2e:record` in web/.',
        'another list, sorted as the decades are': newKind,
      },
      'what each failure said to do about a request with no recording',
    )
    // One nobody waits on fails the file instead, as its browser closes in after().
    await paste(browser, 'zzqq not waited on')
    const offered = await browser.evaluate<boolean>(`new Promise((resolve) => {
      const started = Date.now()
      const look = () => ${retryFor('zzqq not waited on')} ? resolve(true) : Date.now() - started > 10000 ? resolve(false) : setTimeout(look, 100)
      look()
    })`)
    assert.ok(offered, 'the page got no 404 for the search nobody waits on')
    closed = true
    const leftOver = await failure(browser.close())
    assert.ok(
      missed(leftOver, 'zzqq not waited on'),
      `closing the browser after a search with no recording that nobody waited on: ${leftOver}`,
    )
    // It throws only once its Chrome has gone, and the profile with it, so a file that fails this
    // way leaves neither behind.
    assert.deepEqual(
      {
        chrome: await fetch(`http://127.0.0.1:${port}/json/version`).then(
          () => 'still running',
          () => 'gone',
        ),
        profile: existsSync(browser.profile) ? 'still there' : 'gone',
      },
      { chrome: 'gone', profile: 'gone' },
      'closing the browser, which threw for the search nobody waited on, left its Chrome or its profile behind',
    )
  } finally {
    if (!closed) await browser.close().catch(() => {})
  }
})

test('in a recorded browser, a block beats the recordings, a hold delays their answers as long as asked or until holdAniList(0) lets them go, and a rewrite changes a copy of them', async () => {
  const browser = await Browser.open({ aniList: 'recorded', recordings: [firstVisit] })
  try {
    // Held 2 s, the answer comes 2 s late, and no later. This is the browser's first request to
    // AniList, so Chrome sends a CORS preflight before it, as it does whenever its last
    // preflight's answer is over 5 s old: holding the preflight as well would make the answer
    // twice as late. The rewrite changes what it gets where it is, as a check may: the recording
    // must stay as it was.
    await browser.rewriteAniList(({ status, body }) => {
      body.data.trending.media[0].title = { romaji: 'Rewritten title', english: null, native: null }
      return { status, body }
    })
    await browser.holdAniList(2_000)
    let rewritten: { titles: boolean; panels: string[]; took: number[] }
    try {
      await browser.load()
      rewritten = {
        titles: await browser.titlesShown(15_000),
        panels: (await browser.evaluate<Shown>(shown)).panels,
        took: await browser.evaluate<number[]>(answered),
      }
    } finally {
      await browser.holdAniList(0)
      await browser.rewriteAniList(null)
    }
    assert.ok(rewritten.titles, 'no titles came, not even the samples')
    assert.deepEqual(
      rewritten.panels,
      ['Rewritten title', ...trending.slice(1, 9).map(titleOf)],
      'the rewrite did not change the recorded answer',
    )
    assert.equal(rewritten.took.length, 1, 'the page’s requests to AniList that were answered')
    assert.ok(
      rewritten.took[0] >= 1_900 && rewritten.took[0] < 3_000,
      `held for 2 s, the recorded answer came ${rewritten.took[0]} ms after the page asked`,
    )
    // Holding and rewriting no more, the page gets the recording as it was, in the usual time. Its
    // title is written out: a rewrite that changed the recording would have changed `trending`
    // with it.
    await browser.forget()
    await browser.load()
    assert.ok(await browser.titlesShown(15_000), 'no titles came, not even the samples')
    assert.equal(
      (await browser.evaluate<Shown>(shown)).panels[0],
      'Recorded trending title 1',
      'after the rewrite, the recording itself was changed',
    )
    const unheld = await browser.evaluate<number[]>(answered)
    assert.ok(
      unheld[0] < 1_000,
      `after the hold, the recorded answer came ${unheld[0]} ms after the page asked`,
    )
    // Let go early, a held answer comes at once: checks hold answers to look at the page while it
    // loads, then let them go and wait for the titles. The check lets go only once Chrome has
    // paused the page's request: one sent after holdAniList(0) isn't held at all.
    await browser.forget()
    let onHold = false
    browser.onEvent('Fetch.requestPaused', ({ request }) => {
      if (request.method === 'POST') onHold = true
    })
    await browser.holdAniList(10_000)
    let letGo: number
    try {
      await browser.load()
      for (let waited = 0; !onHold && waited < 5_000; waited += 50) await sleep(50)
      assert.ok(onHold, 'the page’s request to AniList never went on hold')
      letGo = Date.now()
    } finally {
      await browser.holdAniList(0)
    }
    const released = await browser.titlesShown(15_000)
    const after = Date.now() - letGo
    assert.ok(released, 'no titles came, not even the samples')
    assert.deepEqual(
      (await browser.evaluate<Shown>(shown)).panels,
      trending.slice(0, 9).map(titleOf),
      'let go of its hold, the page did not show the recorded titles',
    )
    assert.ok(after < 2_000, `let go of a 10 s hold, the titles came ${after} ms later`)
    // Blocked, the page can't reach AniList, so it shows its samples, recorded answer or not.
    await browser.forget()
    await browser.blockAniList()
    await browser.load()
    const blocked = await browser.titlesShown(15_000)
    const { heading, panels } = await browser.evaluate<Shown>(shown)
    await browser.blockAniList(false)
    assert.ok(blocked, 'no titles came, not even the samples')
    assert.deepEqual(
      { heading, panels },
      { heading: 'Fan favorites', panels: SAMPLES.slice(0, 9).map(titleOf) },
      'with AniList blocked, the page did not show its samples',
    )
  } finally {
    await browser.close()
  }
})

test('a rewrite’s headers reach the page in place of the answer’s own, as a 429’s reset time does, and the rest stay', async () => {
  // A check stages a short rate-limit timeout this way: AniList's 429 with an X-RateLimit-Reset a
  // second or two away, where with none the app waits a full minute (see retryAt in anilist.ts).
  const browser = await Browser.open({ aniList: 'recorded', recordings: [firstVisit] })
  const ask = `fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(${JSON.stringify(firstVisit.request)}),
  }).then((res) => ({
    status: res.status,
    reset: res.headers.get('X-RateLimit-Reset'),
    remaining: res.headers.get('X-RateLimit-Remaining'),
    limit: res.headers.get('X-RateLimit-Limit'),
  }))`
  try {
    await browser.load()
    assert.ok(await browser.titlesShown(15_000), 'no titles came, not even the samples')
    await browser.rewriteAniList(() => ({
      status: 429,
      body: { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] },
      headers: { 'X-RateLimit-Reset': '1767225600', 'x-ratelimit-remaining': '0' },
    }))
    let staged: unknown
    try {
      staged = await browser.evaluate(ask)
    } finally {
      await browser.rewriteAniList(null)
    }
    assert.deepEqual(
      staged,
      { status: 429, reset: '1767225600', remaining: '0', limit: '30' },
      'the rewrite’s headers, whatever their case, and the answer’s others',
    )
    assert.deepEqual(
      await browser.evaluate(ask),
      { status: 200, reset: null, remaining: '29', limit: '30' },
      'with the rewrite gone, the recorded answer’s own headers',
    )
  } finally {
    await browser.close()
  }
})

test('a recorded browser can’t reach AniList: a request that gets past the recordings fails to resolve its address', async () => {
  const browser = await Browser.open({ aniList: 'recorded' })
  try {
    // As if a request got past the recordings: nothing answers it here any more.
    await browser.send('Fetch.disable')
    const { errorText } = await browser.send('Page.navigate', {
      url: 'https://graphql.anilist.co/',
    })
    assert.equal(
      errorText,
      'net::ERR_NAME_NOT_RESOLVED',
      'AniList’s address resolved for a request that got past the recordings',
    )
  } finally {
    await browser.close()
  }
})

// A focused button clicks on Space as a keyboard sends it: the key " " goes down on the button,
// with the space it types, which the button keeps from scrolling the page, and the click comes as
// the key comes up. So the lever pulls once, as it does for someone at a keyboard.
test('press() presses Space as a keyboard does: on the focused lever, it pulls once', async () => {
  const browser = await Browser.open({ aniList: 'recorded', recordings: [firstVisit] })
  try {
    await browser.load()
    assert.ok(await browser.titlesShown(15_000), 'no titles came, not even the samples')
    const count = `document.querySelector('.ab-count').textContent`
    assert.deepEqual(
      await browser.evaluate(`(() => {
        const lever = document.querySelector('.ab-lever')
        lever.focus()
        return { focused: document.activeElement === lever, off: lever.disabled, count: ${count} }
      })()`),
      { focused: true, off: false, count: 'No rolls yet' },
      'the lever, before Space',
    )
    await browser.press('Space')
    // The card shows its title 0.7 s after a roll (ROLL_MS), and a second roll would have come by
    // then.
    const opened = await browser.waitFor(`document.querySelector('.ab-result.is-open')`, 5_000)
    assert.deepEqual(
      { opened, count: await browser.evaluate(count) },
      { opened: true, count: '1 roll this visit' },
      'what Space on the focused lever did',
    )
  } finally {
    await browser.close()
  }
})

// One press of a key as a US keyboard sends it, as the page reads it: its key, its code and its
// keyCode, going down, then as a keypress if it types a character, and coming up.
const fromKeyboard = (key: string, code: string, keyCode: number, types = false) =>
  (types ? ['keydown', 'keypress', 'keyup'] : ['keydown', 'keyup'])
    .map((type) => `${type} ${JSON.stringify(key)} ${code} ${keyCode}`)
    .join(', ')

// What the page reads as press() presses each key it knows, beside what a keyboard sends. What a
// key does comes from these: the vibe chips move on the arrows by their key, Chrome scrolls the
// page by the keyCode (PageDown sent with PageUp's scrolls up), and a button clicks on Enter's
// keypress. The table has a row for each key press() knows, so the type check fails while one
// has none. The page is a blank one, where no key does anything.
test('press() presses every key it knows as a keyboard does: its key, code and keyCode, and a keypress for Enter and Space alone', async () => {
  const keyboard: Record<Parameters<Browser['press']>[0], string> = {
    Tab: fromKeyboard('Tab', 'Tab', 9),
    Enter: fromKeyboard('Enter', 'Enter', 13, true),
    Escape: fromKeyboard('Escape', 'Escape', 27),
    Backspace: fromKeyboard('Backspace', 'Backspace', 8),
    Space: fromKeyboard(' ', 'Space', 32, true),
    ArrowLeft: fromKeyboard('ArrowLeft', 'ArrowLeft', 37),
    ArrowUp: fromKeyboard('ArrowUp', 'ArrowUp', 38),
    ArrowRight: fromKeyboard('ArrowRight', 'ArrowRight', 39),
    ArrowDown: fromKeyboard('ArrowDown', 'ArrowDown', 40),
    Home: fromKeyboard('Home', 'Home', 36),
    End: fromKeyboard('End', 'End', 35),
    PageUp: fromKeyboard('PageUp', 'PageUp', 33),
    PageDown: fromKeyboard('PageDown', 'PageDown', 34),
  }
  const browser = await Browser.open({ aniList: 'recorded', recordings: [] })
  try {
    await browser.evaluate(`(() => {
      window.heard = []
      for (const type of ['keydown', 'keypress', 'keyup'])
        addEventListener(type, ({ key, code, keyCode }) => heard.push(type + ' ' + JSON.stringify(key) + ' ' + code + ' ' + keyCode), true)
      return true
    })()`)
    const heard: Record<string, string> = {}
    for (const key of Object.keys(keyboard) as (keyof typeof keyboard)[]) {
      await browser.press(key)
      heard[key] = (await browser.evaluate<string[]>('heard.splice(0)')).join(', ')
    }
    assert.deepEqual(heard, keyboard, 'what the page read as press() pressed each key')
  } finally {
    await browser.close()
  }
})

test('landAll() lands every part still waiting below the first screen, so each shows, still', async () => {
  const browser = await Browser.open()
  try {
    await browser.load()
    assert.ok(await browser.titlesShown())
    const parts = `[...document.querySelectorAll('[data-land]')]`
    const waiting = await browser.evaluate<number>(
      `${parts}.filter((part) => part.dataset.land === 'wait').length`,
    )
    await browser.landAll()
    const shown = await browser.evaluate<string[]>(
      `${parts}.filter((part) => part.dataset.land !== 'done' || getComputedStyle(part.matches('.ab-strip-item') ? part.firstElementChild : part.matches('.ab-sfx') ? part.lastElementChild : part).opacity !== '1').map((part) => part.className + ': ' + part.dataset.land)`,
    )
    assert.ok(waiting >= 6, `only ${waiting} parts waiting below the first screen`)
    assert.deepEqual(shown, [], 'parts landAll() left waiting or see-through')
  } finally {
    await browser.close()
  }
})
