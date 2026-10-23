// My List's page (spec §3.0, §3F), at /list: its own address, which shows My List in place of
// Discover and asks AniList for none of Discover's lists, also under a title's card opened over it.
// AniList's answer for the list's titles is built here from titles already recorded, with a
// rewrite, as the plan's D19 allows: a 200 needs no recording.
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { QUERIES } from '../src/features/anime/queries.ts'
import { BASE_URL, Browser, type Answer } from './browser.ts'
import { listsOf, recordings } from './recordings.ts'

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

// The titles the recorded lists hold, by id, to build AniList's answer for My List from. A title
// asked for on its own comes with its status, which a list's copy doesn't have, so only lists.
const RECORDED = new Map(
  [...recordings()]
    .filter(([name]) => !name.startsWith('title-'))
    .flatMap(([, recording]) => Object.values(listsOf(recording)).flat())
    .map((media) => [media.id, media]),
)
/** AniList's answer for My List's titles, as it would give it: the recorded titles with `ids`. */
const listAnswer = (ids: number[]): Answer => ({
  request: { query: QUERIES.list, variables: { ids } },
  status: 200,
  body: { data: { Page: { media: ids.flatMap((id) => RECORDED.get(id) ?? []) } } },
})
/** Answers My List's request as AniList would (listAnswer), and every other as recorded. */
const answerList = (request: Answer['request']) =>
  request.query === QUERIES.list ? listAnswer(request.variables.ids as number[]) : null

// Frieren, Cowboy Bebop and Neon Genesis Evangelion, each in a recorded list.
const SAVED = [154587, 1, 30]

/**
 * Opens My List with nothing else saved but `ids` on it, Saved, the first the most lately changed.
 * The list is written on the site's own page, before the load that reads it.
 */
async function openList(ids: number[]) {
  await browser.forget()
  await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/list') })
  await browser.evaluate(`(() => {
    const now = Date.now()
    const list = Object.fromEntries(${JSON.stringify(ids)}.map((id, i) => [id, { status: 'SAVED', favorite: false, updatedAt: now - i }]))
    localStorage.setItem('anibeam:list:v1', JSON.stringify(list))
    return true
  })()`)
  await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/list') })
  assert.ok(
    await browser.waitFor(`document.querySelectorAll(${COVERS}).length === ${ids.length}`, 10_000),
    `My List didn't show its ${ids.length} covers`,
  )
}

// My List's covers, each a link to its title's address.
const COVERS = JSON.stringify('#main .ab-strip-panel[href]')
// The open title card's heading, or '' with none open.
const CARD = `document.querySelector('dialog.ab-card[open] #ab-card-title')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`
// What the page under a card is: its heading, and whether Discover's trending is drawn.
const UNDER = `({
  heading: document.querySelector('#main h1')?.firstChild.textContent,
  trending: Boolean(document.getElementById('ab-trending')),
})`
// Reloads the page and waits for the new one: Page.reload returns before it replaces the old one,
// which could otherwise answer what a check waits for next.
async function reload() {
  await browser.evaluate(`window.__beforeReload = true; true`)
  await browser.send('Page.reload')
  await browser.waitFor(`!window.__beforeReload && document.readyState === 'complete'`)
}

test('a card opened over My List keeps My List under it, asks AniList for nothing, and Close or Back returns focus to its cover', async () => {
  const asked = await noteRequests(answerList)
  try {
    await openList(SAVED)
    // Long enough for Discover's lists to have asked, had they been on.
    await sleep(1500)
    assert.deepEqual(asked, ['My List'], 'opening My List')
    asked.length = 0
    const cover = `document.querySelector('#main .ab-strip-panel[href="/anime/1"]')`
    for (const how of ['Close', 'Back']) {
      // As from the keyboard: focused, then pressed.
      await browser.evaluate(`${cover}.focus(); ${cover}.click(); true`)
      assert.ok(await browser.waitFor(`/Bebop/i.test(${CARD})`, 5000), `${how}: no card opened`)
      assert.equal(await where(), '/anime/1')
      // Long enough for Discover's lists to have asked, had they been on.
      await sleep(1500)
      assert.deepEqual(
        { under: await browser.evaluate(UNDER), asked },
        { under: { heading: 'My List', trending: false }, asked: [] },
        `${how}: the page under the card, and what opening it asked AniList for`,
      )
      assert.equal(
        await browser.evaluate(`document.title`),
        `${await browser.evaluate(CARD)} · AniBeam`,
      )
      if (how === 'Close')
        await browser.evaluate(`document.querySelector('dialog[open] .ab-close').click(); true`)
      else await browser.evaluate(`history.back(); true`)
      assert.ok(
        await browser.waitFor(
          `!document.querySelector('dialog[open]') && location.pathname === '/list'`,
          5000,
        ),
        `${how} left the card open, or the page elsewhere`,
      )
      assert.ok(
        await browser.waitFor(`document.activeElement === ${cover}`, 2000),
        `${how}: focus went elsewhere than the cover`,
      )
      assert.equal(await browser.evaluate(`document.title`), 'My List · AniBeam')
    }
    await sleep(1500)
    assert.deepEqual(asked, [], 'opening and closing a card over My List asked AniList')
  } finally {
    await browser.rewriteAniList(null)
  }
})

test('after a reload at a card opened over My List, My List is under it, and stays once it closes, with Discover’s lists never asked for', async () => {
  const asked = await noteRequests(answerList)
  try {
    await openList(SAVED)
    await browser.evaluate(
      `document.querySelector('#main .ab-strip-panel[href="/anime/154587"]').click(); true`,
    )
    assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 5000), 'no card opened')
    asked.length = 0
    await reload()
    assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000), 'no card after the reload')
    assert.deepEqual(await browser.evaluate(UNDER), { heading: 'My List', trending: false })
    await browser.evaluate(`document.querySelector('dialog[open] .ab-close').click(); true`)
    assert.ok(
      await browser.waitFor(
        `!document.querySelector('dialog[open]') && location.pathname === '/list'`,
        5000,
      ),
      'closing left the card open, or the page elsewhere',
    )
    // Long enough for Discover's lists to have asked, had they been on.
    await sleep(1500)
    assert.deepEqual(await browser.evaluate(UNDER), { heading: 'My List', trending: false })
    assert.equal(
      await browser.evaluate(`document.querySelectorAll(${COVERS}).length`),
      SAVED.length,
    )
    // Frieren alone, at its address: My List's titles come from the saved copy.
    assert.deepEqual(asked, ['title 154587'], 'after the reload')
  } finally {
    await browser.rewriteAniList(null)
  }
})
