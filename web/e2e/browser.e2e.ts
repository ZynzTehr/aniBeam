// The browser helper itself: a Chrome that fails to start leaves nothing behind, a browser answers
// AniList from recordings of its answers unless asked for AniList's own, and a recorded browser
// gives the page those, and sends AniList nothing.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { titleOf } from '../src/features/anime/format.ts'
import { FIRST_ERA, QUERIES, type Media } from '../src/features/anime/queries.ts'
import { SAMPLES } from '../src/features/anime/samples.ts'
import { Browser, type AniListMode, type Recording } from './browser.ts'

const profiles = () => readdirSync(tmpdir()).filter((name) => name.startsWith('anibeam-e2e-'))

test('a Chrome that exits at once fails fast and leaves no profile behind', async () => {
  const before = profiles()
  const chromeBin = process.env.CHROME_BIN
  process.env.CHROME_BIN = '/usr/bin/false' // starts, then exits straight away
  try {
    const started = Date.now()
    await assert.rejects(Browser.open(), /exited before it was ready/)
    assert.ok(Date.now() - started < 5_000, 'it waited for a browser that had already exited')
    assert.deepEqual(profiles(), before, 'its profile folder was left behind')
  } finally {
    // The checks below start a real Chrome.
    if (chromeBin === undefined) delete process.env.CHROME_BIN
    else process.env.CHROME_BIN = chromeBin
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
    `(() => { const input = document.querySelector('.ab-search input'); input.focus(); input.select(); return true })()`,
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
    // AniList takes about 230 ms, and the checks were made against that.
    assert.ok(took[0] >= 150, `the recorded answer came ${took[0]} ms after the page asked`)
  } finally {
    await browser.close()
  }
})

test('in a recorded browser, a request with no recording fails the check waiting on it, naming it and how to record it, unless a rewrite answers it', async () => {
  const browser = await Browser.open({
    aniList: 'recorded',
    recordings: [firstVisit, recordedSearch],
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
  let closed = false
  try {
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
    await browser.rewriteAniList(null)
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
  } finally {
    if (!closed) await browser.close().catch(() => {})
  }
})

test('in a recorded browser, a block beats the recordings, a hold delays their answers, and a rewrite changes a copy of them', async () => {
  const browser = await Browser.open({ aniList: 'recorded', recordings: [firstVisit] })
  try {
    // Blocked, the page can't reach AniList, so it shows its samples, recorded answer or not.
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
    // The rewrite changes what it gets where it is, as a check may: the recording must stay as
    // it was.
    await browser.forget()
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
      rewritten.took[0] >= 1_900,
      `held for 2 s, the recorded answer came ${rewritten.took[0]} ms after the page asked`,
    )
    // Rewriting no more, the page gets the recording as it was. Its title is written out: a
    // rewrite that changed the recording would have changed `trending` with it.
    await browser.forget()
    await browser.load()
    assert.ok(await browser.titlesShown(15_000), 'no titles came, not even the samples')
    assert.equal(
      (await browser.evaluate<Shown>(shown)).panels[0],
      'Recorded trending title 1',
      'after the rewrite, the recording itself was changed',
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
