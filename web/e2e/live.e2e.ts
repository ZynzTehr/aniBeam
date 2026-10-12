// Two checks on the real AniList, as every other check answers from recordings (see browser.ts):
// a first visit's one request, for trending and the 1990s, and a search, each sent by the app in
// this file's own live browser, so a run costs AniList 2 requests and a CORS preflight. They judge
// AniList's answer as it came over the network, by live.ts, never by the page's status lines,
// which read the same for a query AniList turns down and for a dead connection: while AniList
// itself is down or busy they skip, saying so, and when it answers in a way the app can't use
// they fail. ANILIST=off allows no live browser, so under it both skip. The file runs after
// discover.e2e.ts, so a whole run with ANILIST=live adds nothing to that file's busiest minute.
import assert from 'node:assert/strict'
import { after, before, test, type TestContext } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'
import { titleOf } from '../src/features/anime/format.ts'
import { FIRST_ERA, QUERIES, searchQuery, type Media } from '../src/features/anime/queries.ts'
import { Browser, type Answer } from './browser.ts'
import { answerProblems, limitProblems, verdict, WAIT_MS, type Seen } from './live.ts'

const ENDPOINT = 'https://graphql.anilist.co'
// Why both checks skip under ANILIST=off; false otherwise.
const off =
  process.env.ANILIST === 'off' &&
  "ANILIST=off allows no live browser, so AniList's API goes unchecked"

let browser: Browser
// Chrome's reports on the page's requests to AniList, joined only when a check reads them, as a
// preflight's can come before or after those of the request it is for: each request, with what it
// asked; the CORS preflight Chrome sent for each, if any (by request id); and for any request, the
// status that came over the network, and why Chrome failed it.
const requests: { id: string; asked: string }[] = []
const preflights = new Map<string, string>()
const statuses = new Map<string, number>()
const failures = new Map<string, string>()
// AniList's answers to the page's requests, as they came: before CORS could keep them from the
// page, and only those in JSON (see rewriteAniList).
const answers: Answer[] = []

before(async () => {
  if (off) return
  browser = await Browser.open({ aniList: 'live' }) // a fresh profile: a first visit
  browser.onEvent('Network.requestWillBeSent', ({ requestId, request, initiator }) => {
    if (!request.url.startsWith(ENDPOINT)) return
    if (initiator.type === 'preflight') preflights.set(initiator.requestId, requestId)
    else requests.push({ id: requestId, asked: request.postData })
  })
  browser.onEvent('Network.responseReceivedExtraInfo', ({ requestId, statusCode }) =>
    statuses.set(requestId, statusCode),
  )
  // A failure CORS caused is named by its kind, such as MissingAllowOriginHeader, which Chrome's
  // own error (net::ERR_FAILED) doesn't say.
  browser.onEvent('Network.loadingFailed', ({ requestId, errorText, corsErrorStatus }) =>
    failures.set(requestId, corsErrorStatus?.corsError ?? errorText),
  )
  await browser.send('Network.enable')
  await browser.rewriteAniList((answer) => {
    answers.push(answer)
    return null // passed on as it came
  })
  // What the page asks AniList with its own fetch, and gets: the status and the rate-limit
  // headers, as far as CORS lets the page read them, or the error.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const fetch = window.fetch
      window.__answers = []
      window.fetch = function (url, init) {
        const answer = fetch.apply(this, arguments)
        if (url === '${ENDPOINT}') {
          const seen = { asked: init?.body }
          window.__answers.push(seen)
          answer.then(
            (response) => Object.assign(seen, { status: response.status, limit: response.headers.get('X-RateLimit-Limit'), remaining: response.headers.get('X-RateLimit-Remaining') }),
            (error) => Object.assign(seen, { error: error.name + ': ' + error.message }),
          )
        }
        return answer
      }
    })()`,
  })
})
after(() => browser?.close())

/** What the page asked AniList with its own fetch, and what it got (see before()). */
type PageGot = { asked: string } & (
  { status: number; limit: string | null; remaining: string | null } | { error: string }
)

/**
 * What the check saw of the page's `n`th request to AniList (from 1), for `what`: AniList's answer
 * as it came over the network, and its preflight's, why Chrome failed it, and what the page's own
 * fetch got within WAIT_MS; and AniList's answer in JSON, with its request, if it came so. Fails
 * if the page never asks, as then AniList has nothing to answer.
 */
async function sawRequest(n: number, what: string) {
  const got = `window.__answers[${n - 1}]`
  assert.ok(await browser.waitFor(got, 10_000), `the page never asked AniList for ${what}`)
  const settled = await browser.waitFor(`'status' in ${got} || 'error' in ${got}`, WAIT_MS)
  const mine = await browser.evaluate<PageGot>(got)
  const page = settled ? mine : undefined
  // Chrome's reports, and AniList's answer, are found by what the request asked: the page counts
  // its requests afresh should it load again (say, as Vite reloads it), while Chrome's go on. The
  // latest that asked it is this one, as the app asks again only a second or more after an answer.
  const id = requests.findLast(({ asked }) => asked === mine.asked)?.id ?? ''
  // Chrome's report can come a moment after the page has its answer.
  const reported = () => statuses.has(id) || failures.has(id)
  for (let waited = 0; settled && !reported() && waited < 2_000; waited += 50) await sleep(50)
  const answer = answers.findLast(({ request }) =>
    isDeepStrictEqual(request, JSON.parse(mine.asked)),
  )
  const preflight = preflights.get(id) ?? ''
  const [status, preflightStatus] = [statuses.get(id), statuses.get(preflight)]
  const seen: Seen = {
    post: status === undefined ? undefined : { status, body: answer?.body },
    preflight: preflightStatus === undefined ? undefined : { status: preflightStatus },
    failure: failures.get(id) ?? failures.get(preflight),
    page,
  }
  return { seen, answer, page }
}

/**
 * Leaves the app for a blank page, so it sends AniList nothing more: no retry, no next request.
 * A Chrome that has gone sends nothing either, and what went wrong is told elsewhere.
 */
const leave = () => browser.send('Page.navigate', { url: 'about:blank' }).catch(() => {})

/**
 * A one-line query from Node, sent only after a 5xx, to tell AniList being down from the app's
 * query tripping it up: its status, or 0 for no answer within 10 seconds.
 */
const health = () =>
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: '{ Media(id: 1) { id } }' }),
    signal: AbortSignal.timeout(10_000),
  }).then(
    (response) => response.status,
    () => 0,
  )

/**
 * Does as verdict() says about what the check saw of the app's `request`: null if there is
 * nothing to say. Otherwise it first leaves the page, ahead of the health query too: the app
 * tries a 5xx again within a second, and anything else that failed once AniList's minute is up,
 * which would send AniList more. Then it fails the check, or skips it and returns why.
 */
async function judge(t: TestContext, request: 'first-visit' | 'search', seen: Seen) {
  let said = verdict(request, seen)
  if (!said) return null
  await leave()
  if ('probe' in said) said = verdict(request, { ...seen, health: await health() })
  if (said && 'skip' in said) {
    t.skip(said.skip)
    return said.skip
  }
  assert.fail(said && 'fail' in said ? said.fail : `no verdict on ${JSON.stringify(seen)}`)
}

/** Runs the rest of a check, once verdict() has let it through, leaving the page if it fails. */
async function onPage(check: () => Promise<void>) {
  try {
    await check()
  } catch (error) {
    await leave()
    throw error
  }
}

// How many requests the page has sent AniList (see before()).
const sentCount = 'window.__answers.length'

// What the visitor sees of a first visit: the trending heading, the panels' titles, the decade
// strip's and both sections' status lines.
const shown = `({
  heading: document.getElementById('ab-trending').firstChild.textContent,
  panels: [...document.querySelectorAll('.ab-grid .ab-caption b')].map((title) => title.textContent),
  strip: [...document.querySelectorAll('.ab-strip-row .ab-strip-title')].map((title) => title.textContent),
  notes: [...document.querySelectorAll('.ab-note')].map((note) => note.textContent),
})`

// What the first check passes on to the search check: once it passes, AniList's trending titles
// and how many requests AniList said were left this minute; or why it skipped.
let trending: Media[] | undefined
let left: string | null = null
let skipped: string | null = null

test(
  'AniList still answers a first visit’s one request for trending and the 1990s, as the app reads it',
  { skip: off },
  async (t) => {
    await browser.load()
    const { seen, answer, page } = await sawRequest(1, 'a first visit’s lists')
    skipped = await judge(t, 'first-visit', seen)
    if (skipped) return
    await onPage(async () => {
      assert.ok(seen.post && page && 'status' in page, 'Chrome reported no answer from AniList')
      assert.ok(
        answer,
        `AniList answered a first visit with HTTP ${seen.post.status}, but not in JSON`,
      )
      assert.deepEqual(
        answer.request,
        { query: QUERIES.firstVisit, variables: FIRST_ERA.variables },
        'the page’s first request was not the app’s one request for both of a first visit’s lists',
      )
      assert.deepEqual(
        [...answerProblems(answer), ...limitProblems(page)],
        [],
        'AniList’s answer to a first visit, as the app reads it',
      )
      t.diagnostic(
        `AniList allows ${page.limit} requests a minute; ${page.remaining} left after this one`,
      )
      const lists = answer.body.data
      assert.ok(await browser.titlesShown(10_000), 'the page never showed its titles')
      assert.deepEqual(
        await browser.evaluate(shown),
        {
          heading: 'Trending now',
          panels: lists.trending.media.slice(0, 9).map(titleOf),
          strip: lists.era.media.map(titleOf),
          notes: ['', ''],
        },
        'the page did not show AniList’s titles under ‘Trending now’, with quiet status lines',
      )
      assert.equal(await browser.evaluate(sentCount), 1, 'the page’s requests to AniList')
      trending = lists.trending.media
      left = page.remaining
    })
  },
)

test('AniList’s search still finds a trending title by its name', { skip: off }, async (t) => {
  if (!trending)
    return t.skip(
      skipped
        ? `the check above skipped: ${skipped}`
        : 'the check above didn’t pass, so there is no trending title to search for',
    )
  // anilist() holds the app's requests when AniList says none are left this minute.
  if (left === '0')
    return t.skip(
      "AniList is busy: it had no requests left for this machine this minute (X-RateLimit-Remaining: 0), so the app holds its search back. It's not the app. Run the live checks again in a minute.",
    )
  // The first trending title whose name the app would search for: it waits for 2 characters.
  const wanted = trending.find((media) => media.title.romaji.trim().length >= 2) ?? trending[0]
  const name = wanted.title.romaji
  // Pasted in one go, so the app sends one search, for the whole name.
  await browser.evaluate(
    `(() => { const input = document.querySelector('.ab-search input'); input.focus(); input.select(); return true })()`,
  )
  await browser.send('Input.insertText', { text: name })
  const { seen, answer, page } = await sawRequest(2, `a search for ${JSON.stringify(name)}`)
  if (await judge(t, 'search', seen)) return
  await onPage(async () => {
    assert.ok(seen.post && page && 'status' in page, 'Chrome reported no answer from AniList')
    assert.ok(answer, `AniList answered the search with HTTP ${seen.post.status}, but not in JSON`)
    assert.deepEqual(
      answer.request,
      { query: QUERIES.search, variables: searchQuery(name).queryKey[2] },
      'the page’s request was not the app’s search for the name',
    )
    assert.deepEqual(
      [...answerProblems(answer, wanted), ...limitProblems(page)],
      [],
      'AniList’s answer to a search, as the app reads it',
    )
    const found = answer.body.data.Page.media.map((media: Media) => media.id)
    assert.ok(
      await browser.waitFor(
        `document.querySelector('.ab-results .ab-strip-panel[href="#title-${wanted.id}"]')`,
        5_000,
      ),
      'the page did not show the title among the results',
    )
    assert.equal(await browser.evaluate(sentCount), 2, 'the page’s requests to AniList')
    t.diagnostic(
      `searching ${JSON.stringify(answer.request.variables.search)} found it at ${found.indexOf(wanted.id) + 1} of ${found.length}`,
    )
  })
})
