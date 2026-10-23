// My List's page (spec §3.0, §3F), at /list: its own address, which shows My List in place of
// Discover and asks AniList for none of Discover's lists, also under a title's card opened over it.
// AniList's answer for the list's titles is built here from titles already recorded, with a
// rewrite, as the plan's D19 allows: a 200 needs no recording.
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { QUERIES } from '../src/features/anime/queries.ts'
import { BASE_URL, Browser, type Answer } from './browser.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open()
})
after(() => browser?.close())

// Each check fails on an uncaught exception, or a console error or warning, from the page while it
// ran (see Browser.problems).
let problemsBefore = 0
beforeEach(() => {
  problemsBefore = browser.problems.length
})
afterEach(() => {
  assert.deepEqual(browser.problems.slice(problemsBefore), [], 'the page reported problems')
})

const DESKTOP = { width: 1440, height: 900 }
const at = (path: string) => new URL(path, BASE_URL).href
const where = () => browser.evaluate<string>(`location.pathname + location.search + location.hash`)

/** A request to AniList in a word: which list it asks for, or the title it asks for alone. */
const kindOf = ({ query, variables }: Answer['request']) =>
  query === QUERIES.firstVisit
    ? 'trending + 1990s'
    : query === QUERIES.trending
      ? 'trending'
      : query === QUERIES.era
        ? 'a decade'
        : query === QUERIES.list
          ? 'My List'
          : query === QUERIES.title
            ? `title ${variables.id}`
            : JSON.stringify(query.slice(0, 40))

/**
 * Notes each request the page sends AniList from now on, in a word (kindOf), into the list it
 * returns, and answers each as `answer` does, or as recorded when it gives null.
 */
async function noteRequests(answer: (request: Answer['request']) => Answer | null = () => null) {
  const asked: string[] = []
  await browser.rewriteAniList(({ request }) => {
    asked.push(kindOf(request))
    const answered = answer(request)
    return answered && { status: answered.status, body: answered.body }
  })
  return asked
}

test('/list and /list/ stay at their address and show My List, asking AniList for none of Discover’s lists', async () => {
  for (const path of ['/list', '/list/']) {
    // A first visit, so Discover, drawn, would ask for its first lists at once.
    await browser.forget()
    const asked = await noteRequests()
    try {
      await browser.load({ ...DESKTOP, reduceMotion: true, url: at(path) })
      // Long enough for Discover's lists to have asked, had they been on.
      await sleep(1500)
      assert.deepEqual(
        { address: await where(), asked },
        { address: path, asked: [] },
        `${path}: where it was, and what it asked AniList for`,
      )
      assert.deepEqual(
        await browser.evaluate(`({
          heading: document.querySelector('#main h1')?.firstChild.textContent,
          tab: document.title,
          trending: Boolean(document.getElementById('ab-trending')),
        })`),
        { heading: 'My List', tab: 'My List · AniBeam', trending: false },
        `${path}: the page`,
      )
    } finally {
      await browser.rewriteAniList(null)
    }
  }
})
