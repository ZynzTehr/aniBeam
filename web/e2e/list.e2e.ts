// My List's page (spec §3.0, §3F), at /list: its own address, which shows My List in place of
// Discover and asks AniList for none of Discover's lists, also under a title's card opened over it;
// its tabs and Favorites only, links that change the address (?tab=want, &fav=1); and its titles,
// asked for in one request. The 12 titles of the list-12 recording (see LISTS in recordings.ts) are
// answered as AniList answered them; any other list's answer is built here from titles already
// recorded, with a rewrite, as the plan's D19 allows: a 200 needs no recording. A title taken off
// the list on the page leaves an Undo in its place.
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { QUERIES } from '../src/features/anime/queries.ts'
import { BASE_URL, Browser, type Answer } from './browser.ts'
import { listsOf, recordings } from './recordings.ts'

let browser: Browser
// What the page sent AniList's API, as the guarded Chrome's own network log has it, not as the page
// tells it: each request's GraphQL. A CORS preflight, which carries none, isn't counted.
const sent: Answer['request'][] = []
before(async () => {
  browser = await Browser.open()
  browser.onEvent('Network.requestWillBeSent', ({ request }) => {
    if (request.method !== 'POST' || new URL(request.url).hostname !== 'graphql.anilist.co') return
    const body =
      request.postData ??
      (request.postDataEntries ?? [])
        .map(({ bytes }: { bytes: string }) => Buffer.from(bytes, 'base64').toString())
        .join('')
    sent.push(JSON.parse(body))
  })
  await browser.send('Network.enable')
  await browser.watchLayoutShifts()
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

/** A title on the list: Saved unless it says Want to try, and with the heart if it says so. */
type Saved = { id: number; status?: 'SAVED' | 'WANT'; favorite?: boolean }

/**
 * Writes `entries` as the visitor's list, in place of any saved, the first the most lately changed,
 * on the site's page open now in `on`: the next load reads it.
 */
async function writeList(entries: Saved[], on = browser) {
  await on.evaluate(`(() => {
    const now = Date.now()
    const list = Object.fromEntries(${JSON.stringify(entries)}.map(({ id, status = 'SAVED', favorite = false }, i) => [id, { status, favorite, updatedAt: now - i }]))
    localStorage.setItem('anibeam:list:v1', JSON.stringify(list))
    return true
  })()`)
}

/**
 * Loads `path` with nothing else saved but `entries` on the list (see writeList), which is written
 * on the site's own page, before the load that reads it.
 */
async function saveList(entries: Saved[], path = '/list') {
  await browser.forget()
  await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/list') })
  await writeList(entries)
  await browser.load({ ...DESKTOP, reduceMotion: true, url: at(path) })
}

/**
 * Opens My List with nothing else saved but `ids` on it, Saved, the first the most lately changed.
 */
async function openList(ids: number[]) {
  await saveList(ids.map((id) => ({ id })))
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

// The 12 titles of the list-12 recording, whose answer AniList gave (see LISTS in recordings.ts),
// the first the most lately changed: Saved 8 (Neon Genesis Evangelion with the heart), and Want to
// try 4 (Frieren and Nausicaä with it). Frieren's own answer is recorded too, for a card reloaded
// at its address.
const TWELVE: Saved[] = [
  { id: 154587, status: 'WANT', favorite: true },
  { id: 21, status: 'WANT' },
  { id: 1 },
  { id: 30, favorite: true },
  { id: 572, status: 'WANT', favorite: true },
  { id: 195516 },
  { id: 47 },
  { id: 164 },
  { id: 97940, status: 'WANT' },
  { id: 339 },
  { id: 437 },
  { id: 523 },
]
const ids = (entries: Saved[]) => entries.map(({ id }) => id)
const SAVED_8 = ids(TWELVE.filter(({ status }) => status !== 'WANT'))
const WANT_4 = ids(TWELVE.filter(({ status }) => status === 'WANT'))
const LIST_12 = ids(TWELVE).toSorted((a, b) => a - b)

// What My List shows: the address, each of its links (tabs, then Favorites only) with where it goes
// and whether it is marked current, its covers' titles in order, the empty state's words and link,
// and its notes.
const PAGE = `(() => {
  const main = document.querySelector('#main')
  return {
    address: location.pathname + location.search,
    links: [...main.querySelectorAll('nav[aria-label="My List"] a')].map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')]),
    covers: [...main.querySelectorAll('.ab-strip-panel[href]')].map((a) => Number(a.getAttribute('href').slice('/anime/'.length))),
    empty: [...main.querySelectorAll('.ab-list-empty :is(p, a)')].map((e) => e.tagName === 'A' ? e.textContent + ' ' + e.getAttribute('href') : e.textContent),
    notes: [...main.querySelectorAll('.ab-list-order, .ab-list-foot p')].map((p) => p.textContent),
  }
})()`
type Page = {
  address: string
  links: [string, string, string | null][]
  covers: number[]
  empty: string[]
  notes: string[]
}
const NOTES = ['Order: Recently changed', 'Saved in this browser only.']
// My List's links at each view, with the list as TWELVE has it.
const LINKS: Record<string, Page['links']> = {
  '/list': [
    ['Saved 8', '/list', 'page'],
    ['Want to try 4', '/list?tab=want', null],
    ['Favorites only', '/list?fav=1', null],
  ],
  '/list?tab=want': [
    ['Saved 8', '/list', null],
    ['Want to try 4', '/list?tab=want', 'page'],
    ['Favorites only', '/list?tab=want&fav=1', null],
  ],
  '/list?tab=want&fav=1': [
    ['Saved 8', '/list?fav=1', null],
    ['Want to try 4', '/list?tab=want&fav=1', 'page'],
    ['Favorites only', '/list?tab=want', 'true'],
  ],
  '/list?fav=1': [
    ['Saved 8', '/list?fav=1', 'page'],
    ['Want to try 4', '/list?tab=want&fav=1', null],
    ['Favorites only', '/list', 'true'],
  ],
}

/** Clicks My List's link that starts with `name`, as a mouse does, and waits for the address. */
async function follow(name: string, address: string) {
  await browser.evaluate(
    `[...document.querySelectorAll('#main nav[aria-label="My List"] a')].find((a) => a.textContent.startsWith(${JSON.stringify(name)})).click(); true`,
  )
  assert.ok(
    await browser.waitFor(`location.pathname + location.search === ${JSON.stringify(address)}`),
    `${name} didn't go to ${address}`,
  )
}

test('a cold My List with 12 titles saved asks AniList once, for all 12 by sorted id, in Chrome’s own network log; its tabs, Favorites only and a reload ask for nothing', async () => {
  // The load before the list is written asks for nothing, as nothing is saved.
  sent.length = 0
  await saveList(TWELVE)
  assert.ok(
    await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 8`, 10_000),
    'My List didn’t show its 8 Saved covers',
  )
  // Long enough for any other request to have gone out.
  await sleep(1500)
  assert.deepEqual(
    sent,
    [{ query: QUERIES.list, variables: { ids: LIST_12 } }],
    'what a cold My List sent AniList (the plan’s done-when 2)',
  )
  // Saved, in the list's order (the most lately changed first), not AniList's.
  assert.deepEqual(await browser.evaluate(PAGE), {
    address: '/list',
    links: LINKS['/list'],
    covers: SAVED_8,
    empty: [],
    notes: NOTES,
  })
  // A tab or the filter changes the address with no new page (the marker stays), and each shows
  // its titles from the one answer.
  await browser.evaluate(`window.__samePage = true`)
  const views: [string, string, number[]][] = [
    ['Want to try', '/list?tab=want', WANT_4],
    ['Favorites only', '/list?tab=want&fav=1', [154587, 572]],
    ['Saved', '/list?fav=1', [30]],
    ['Favorites only', '/list', SAVED_8],
  ]
  for (const [name, address, covers] of views) {
    await follow(name, address)
    assert.deepEqual(
      await browser.evaluate(PAGE),
      { address, links: LINKS[address], covers, empty: [], notes: NOTES },
      `after ${name}`,
    )
  }
  // Back and Forward move between the views.
  await browser.evaluate(`history.back(); true`)
  assert.ok(await browser.waitFor(`location.search === '?fav=1'`), 'Back went elsewhere')
  assert.deepEqual((await browser.evaluate<Page>(PAGE)).covers, [30], 'after Back')
  assert.equal(await browser.evaluate(`window.__samePage`), true, 'a link loaded a new page')
  await reload()
  assert.ok(
    await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 1`, 10_000),
    'after a reload, My List didn’t show its 1 cover',
  )
  assert.deepEqual((await browser.evaluate<Page>(PAGE)).links, LINKS['/list?fav=1'])
  await sleep(1500)
  assert.equal(
    sent.length,
    1,
    'the tabs, the filter, Back or a reload within 6 hours asked AniList',
  )
})

// Each place in My List's row as it shows: a cover's title, or 'wait' for an empty card.
const ROW = `[...document.querySelectorAll('#main .ab-strip-row > li')].map((li) => li.querySelector('a')?.getAttribute('href').slice('/anime/'.length) ?? 'wait')`

test('while My List’s answer comes, an empty card holds each title’s place, those other answers have shown at once, and nothing moves as the titles land', async () => {
  try {
    // Cold, on Want to try: an empty card for each of its 4 titles, with the Loading tag over them.
    await browser.holdAniList(3000)
    await saveList(TWELVE, '/list?tab=want')
    assert.deepEqual(
      await browser.evaluate(
        `({ row: ${ROW}, tag: document.querySelector('#main .ab-note-tag')?.textContent })`,
      ),
      { row: WANT_4.map(() => 'wait'), tag: 'Loading…' },
      'cold, while the answer comes',
    )
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 4`, 10_000),
      'cold: My List didn’t show its 4 covers in Want to try',
    )
    assert.deepEqual(await browser.evaluate(ROW), WANT_4.map(String))
    const cold = await browser.layoutShift()
    assert.equal(cold.value.toFixed(4), '0.0000', `cold: ${JSON.stringify(cold.shifts)}`)

    // After a first visit to Discover, whose trending and 1990s hold 6 of the 8: those show at
    // once, in their places, and an empty card holds each of the other two's.
    await browser.forget()
    await browser.holdAniList(0)
    await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/') })
    assert.ok(await browser.titlesShown(), 'Discover showed no titles')
    assert.ok(
      await browser.waitFor(
        `(localStorage.getItem('anibeam:cache') ?? '').includes('Cowboy Bebop')`,
      ),
      'Discover’s lists weren’t saved',
    )
    await writeList(TWELVE)
    await browser.holdAniList(3000)
    await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/list') })
    const atHand = new Set([1, 30, 195516, 164, 339, 437])
    assert.deepEqual(
      await browser.evaluate(ROW),
      SAVED_8.map((id) => (atHand.has(id) ? String(id) : 'wait')),
      'with Discover’s lists saved, while the answer comes',
    )
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 8`, 10_000),
      'with copies: My List didn’t show its 8 Saved covers',
    )
    assert.deepEqual(await browser.evaluate(ROW), SAVED_8.map(String))
    const warm = await browser.layoutShift()
    assert.equal(warm.value.toFixed(4), '0.0000', `with copies: ${JSON.stringify(warm.shifts)}`)
  } finally {
    await browser.holdAniList(0)
  }
})

test('with Favorites only on, a title that loses its heart in its card stays in its place, and a card reloaded over a tab keeps that tab under it', async () => {
  await saveList(TWELVE, '/list?tab=want&fav=1')
  assert.ok(
    await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 2`, 10_000),
    'My List didn’t show its 2 favorites in Want to try',
  )
  const cover = (id: number) =>
    `document.querySelector('#main .ab-strip-panel[href="/anime/${id}"]')`
  await browser.evaluate(`${cover(572)}.click(); true`)
  assert.ok(await browser.waitFor(`/Nausica/.test(${CARD})`, 5000), 'no card opened')
  // The spec's "Track on AniList" is the card's own link (the plan's D6).
  assert.equal(
    await browser.evaluate(
      `document.querySelector('dialog[open] a[href="https://anilist.co/anime/572"]')?.textContent`,
    ),
    'Open on AniList',
  )
  await browser.evaluate(`document.querySelector('dialog[open] .ab-heart').click(); true`)
  assert.ok(
    await browser.waitFor(
      `document.querySelector('dialog[open] .ab-heart').getAttribute('aria-pressed') === 'false'`,
    ),
    'the heart stayed on',
  )
  await browser.evaluate(`document.querySelector('dialog[open] .ab-close').click(); true`)
  assert.ok(
    await browser.waitFor(
      `!document.querySelector('dialog[open]') && location.search === '?tab=want&fav=1'`,
      5000,
    ),
    'closing left the card open, or the page elsewhere',
  )
  assert.deepEqual(
    await browser.evaluate(PAGE),
    {
      address: '/list?tab=want&fav=1',
      links: LINKS['/list?tab=want&fav=1'],
      covers: [154587, 572],
      empty: [],
      notes: NOTES,
    },
    'after its heart went',
  )
  // Frieren's card, reloaded at its address: My List under it is on Want to try, Favorites only.
  await browser.evaluate(`${cover(154587)}.click(); true`)
  assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 5000), 'no card opened')
  await reload()
  assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000), 'no card after the reload')
  assert.ok(
    await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 1`, 10_000),
    'My List under the reloaded card didn’t show its 1 cover',
  )
  const under = await browser.evaluate<Page>(PAGE)
  assert.deepEqual(
    { links: under.links, covers: under.covers },
    { links: LINKS['/list?tab=want&fav=1'], covers: [154587] },
    'under the reloaded card',
  )
  await browser.evaluate(`document.querySelector('dialog[open] .ab-close').click(); true`)
  assert.ok(
    await browser.waitFor(
      `!document.querySelector('dialog[open]') && location.search === '?tab=want&fav=1'`,
      5000,
    ),
    'closing the reloaded card left it open, or the page elsewhere',
  )
})

test('an empty tab or filter says so, with a way on, and the note about this browser shows in each', async () => {
  const asked = await noteRequests(answerList)
  try {
    await saveList([])
    assert.deepEqual(await browser.evaluate(PAGE), {
      address: '/list',
      links: [
        ['Saved 0', '/list', 'page'],
        ['Want to try 0', '/list?tab=want', null],
        ['Favorites only', '/list?fav=1', null],
      ],
      covers: [],
      empty: ['Nothing saved yet.', 'Browse what’s trending /#ab-trending'],
      notes: NOTES,
    })
    await follow('Want to try', '/list?tab=want')
    assert.deepEqual((await browser.evaluate<Page>(PAGE)).empty, [
      'Nothing to try yet.',
      'Browse what’s trending /#ab-trending',
    ])
    assert.deepEqual(asked, [], 'an empty list asked AniList')
    // Cowboy Bebop, Saved, with no heart.
    await saveList([{ id: 1 }], '/list?fav=1')
    assert.deepEqual((await browser.evaluate<Page>(PAGE)).empty, [
      'No favorites in Saved yet.',
      'Show all /list',
    ])
    await follow('Want to try', '/list?tab=want&fav=1')
    assert.deepEqual((await browser.evaluate<Page>(PAGE)).empty, [
      'No favorites in Want to try yet.',
      'Show all /list?tab=want',
    ])
    await follow('Saved', '/list?fav=1')
    // Show all takes its empty state off the page, link and all: focus goes to My List's heading,
    // not to the page's start.
    const showAll = `document.querySelector('#main .ab-list-empty a')`
    await browser.evaluate(`${showAll}.focus(); ${showAll}.click(); true`)
    assert.ok(await browser.waitFor(`location.search === ''`), 'Show all went elsewhere')
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 1`, 10_000),
      'Show all didn’t show the 1 Saved title',
    )
    assert.deepEqual(
      {
        empty: (await browser.evaluate<Page>(PAGE)).empty,
        focused: await browser.evaluate(
          `document.activeElement.id || document.activeElement.tagName`,
        ),
      },
      { empty: [], focused: 'ab-list' },
      'after Show all',
    )
  } finally {
    await browser.rewriteAniList(null)
  }
})

test('Browse what’s trending goes to Discover with no new page and jumps to its Trending heading, focused, where the header’s Trending link lands it; Back returns to My List', async () => {
  await saveList([])
  const heading = `document.getElementById('ab-trending')`
  const browse = `document.querySelector('#main .ab-list-empty a')`
  // By the keyboard, so the window's mark would go with a new page.
  await browser.evaluate(`window.__stayed = true; ${browse}.focus(); true`)
  await browser.press('Enter')
  assert.ok(
    await browser.waitFor(
      `location.pathname + location.hash === '/#ab-trending' && document.activeElement === ${heading}`,
      5000,
    ),
    `Browse what’s trending: ${await where()}, focus on ${await browser.evaluate(`document.activeElement.id || document.activeElement.tagName`)}`,
  )
  assert.ok(await browser.titlesShown(), 'Discover showed no titles')
  const landed = `({ stayed: window.__stayed === true, focused: document.activeElement.id, top: Math.round(${heading}.getBoundingClientRect().top) })`
  const browsed = await browser.evaluate<{ top: number }>(landed)
  await browser.evaluate(`history.back(); true`)
  assert.ok(
    await browser.waitFor(`location.pathname === '/list' && ${browse}`, 5000),
    `Back went to ${await where()}`,
  )
  // The header's own Trending link, on Discover, from its top.
  await browser.evaluate(`history.forward(); true`)
  assert.ok(await browser.waitFor(heading, 5000), 'Forward didn’t return to Discover')
  await browser.evaluate(
    `scrollTo(0, 0); document.querySelector('.ab-nav a[href="#ab-trending"]').click(); true`,
  )
  assert.ok(await browser.waitFor(`document.activeElement === ${heading}`, 5000))
  const linked = await browser.evaluate<{ top: number }>(landed)
  assert.deepEqual(browsed, { stayed: true, focused: 'ab-trending', top: linked.top })
  assert.ok(browsed.top > 0 && browsed.top < 200, `the heading's top: ${browsed.top}px`)
})

test('with more than 50 titles, My List asks for the 50 most lately changed, and says so; a view whose titles are all older says that, and 50 titles need no note', async () => {
  // 52 Saved, the 2 oldest of them with the heart, then 3 Want to try, older still: the 50 most
  // lately changed are all Saved, with no heart.
  const fiftyFive = [...RECORDED.keys()].slice(0, 55)
  const entries: Saved[] = fiftyFive.map((id, i) => ({
    id,
    status: i < 52 ? 'SAVED' : 'WANT',
    favorite: i === 50 || i === 51,
  }))
  const asked: Answer['request'][] = []
  await browser.rewriteAniList(({ request }) => {
    asked.push(request)
    return answerList(request)
  })
  try {
    await saveList(entries)
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 50`, 10_000),
      'My List didn’t show 50 covers',
    )
    const notes = ['Order: Recently changed', 'Showing your 50 most recent.', NOTES[1]]
    const page = await browser.evaluate<Page>(PAGE)
    assert.deepEqual(
      {
        covers: page.covers,
        notes: page.notes,
        tabs: page.links.slice(0, 2).map(([name]) => name),
      },
      { covers: fiftyFive.slice(0, 50), notes, tabs: ['Saved 52', 'Want to try 3'] },
    )
    // Each view whose titles are all older than the 50 says so in place of its titles, in the
    // empty state's own place; one with no titles at all says that.
    const views: [string, string, string[]][] = [
      [
        'Want to try',
        '/list?tab=want',
        ['Your 3 Want to try titles are older than your 50 most recent.'],
      ],
      [
        'Favorites only',
        '/list?tab=want&fav=1',
        ['No favorites in Want to try yet.', 'Show all /list?tab=want'],
      ],
      [
        'Saved',
        '/list?fav=1',
        ['Your 2 favorites in Saved are older than your 50 most recent.', 'Show all /list'],
      ],
    ]
    for (const [name, address, empty] of views) {
      await follow(name, address)
      const shown = await browser.evaluate<Page>(PAGE)
      assert.deepEqual(
        { covers: shown.covers, empty: shown.empty, notes: shown.notes },
        { covers: [], empty, notes },
        address,
      )
    }
    assert.deepEqual(asked, [
      { query: QUERIES.list, variables: { ids: fiftyFive.slice(0, 50).toSorted((a, b) => a - b) } },
    ])

    // 50 titles, all shown: no note says some aren't.
    await saveList(fiftyFive.slice(0, 50).map((id) => ({ id })))
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 50`, 10_000),
      'My List didn’t show its 50 covers',
    )
    assert.deepEqual((await browser.evaluate<Page>(PAGE)).notes, NOTES, '50 titles')
  } finally {
    await browser.rewriteAniList(null)
  }
})

// Each place in My List's row: a cover's title, or the words in its place (the Undo slot's).
const SLOTS = `[...document.querySelectorAll('#main .ab-strip-row > li')].map((li) => li.querySelector('a.ab-strip-panel')?.getAttribute('href').slice('/anime/'.length) ?? li.textContent)`
// The entry the saved list holds for a title.
const entryOf = (id: number) =>
  browser.evaluate<{ status: string; favorite: boolean; updatedAt: number; deleted?: true }>(
    `JSON.parse(localStorage.getItem('anibeam:list:v1'))[${id}]`,
  )
// My List's answer as the saved copy of AniList's answers holds it: when it came, and its titles.
const SAVED_ANSWER = `(() => {
  const queries = JSON.parse(localStorage.getItem('anibeam:cache') ?? '{}').clientState?.queries ?? []
  const list = queries.find(({ queryKey }) => queryKey[1] === ${JSON.stringify(QUERIES.list)})
  return list && { at: list.state.dataUpdatedAt, ids: list.state.data.map(({ id }) => id) }
})()`
const UNDO = `document.querySelector('#main [data-undo]')`
// Presses one of the open card's My List buttons by its label.
const press = (label: string) =>
  browser.evaluate(
    `[...document.querySelectorAll('dialog.ab-card[open] [role="group"] button')].find((button) => button.textContent.trim() === ${JSON.stringify(label)}).click(), true`,
  )

/**
 * Opens the card of the title on My List with `id`, and takes it off there, with its pressed
 * status.
 */
async function removeInCard(id: number, title: RegExp) {
  await browser.evaluate(
    `document.querySelector('#main .ab-strip-panel[href="/anime/${id}"]').focus(); document.querySelector('#main .ab-strip-panel[href="/anime/${id}"]').click(); true`,
  )
  assert.ok(await browser.waitFor(`${title}.test(${CARD})`, 5000), 'no card opened')
  await browser.evaluate(
    `document.querySelector('dialog[open] .ab-mylist [aria-pressed="true"]:not(.ab-heart)').click(); true`,
  )
  assert.ok(
    await browser.waitFor(
      `!document.querySelector('dialog[open] .ab-mylist [aria-pressed="true"]')`,
    ),
    'the title stayed on the list',
  )
}

test('a title taken off in its card leaves an Undo in its place, with focus on Undo once the card closes; Undo puts it back as a new edit, heart and all, and asks for nothing', async () => {
  await saveList(TWELVE, '/list?tab=want')
  assert.ok(
    await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 4`, 10_000),
    'My List didn’t show its 4 covers in Want to try',
  )
  await browser.waitFor(`${SAVED_ANSWER}?.ids.length === 12`)
  const answer = await browser.evaluate(SAVED_ANSWER)
  sent.length = 0
  for (const how of ['Close', 'Back']) {
    const before = await entryOf(572)
    await removeInCard(572, /Nausica/)
    if (how === 'Close')
      await browser.evaluate(`document.querySelector('dialog[open] .ab-close').click(); true`)
    else await browser.evaluate(`history.back(); true`)
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog[open]') && ${UNDO}`, 5000),
      `${how}: no Undo once the card closed`,
    )
    assert.deepEqual(
      await browser.evaluate(SLOTS),
      ['154587', '21', 'Removed from Want to try. Undo', '97940'],
      `${how}: the row`,
    )
    assert.ok(
      await browser.waitFor(`document.activeElement === ${UNDO}`, 2000),
      `${how}: focus went elsewhere than Undo`,
    )
    // In the cover's own place, the size of a cover, so nothing moves.
    const size = (element: string) =>
      browser.evaluate(
        `(({ width, height }) => [Math.round(width), Math.round(height)])(${element}.getBoundingClientRect())`,
      )
    assert.deepEqual(
      await size(`${UNDO}.closest('li').firstElementChild`),
      await size(`document.querySelector('#main .ab-strip-panel[href]')`),
      `${how}: the Undo's size`,
    )
    const marker = await entryOf(572)
    assert.equal(marker.deleted, true, `${how}: no delete marker`)
    await browser.evaluate(`${UNDO}.click(); true`)
    const cover = `document.querySelector('#main .ab-strip-panel[href="/anime/572"]')`
    assert.ok(
      await browser.waitFor(`document.activeElement === ${cover}`, 2000),
      `${how}: after Undo, focus went elsewhere than its cover`,
    )
    assert.deepEqual(await browser.evaluate(SLOTS), ['154587', '21', '572', '97940'])
    const back = await entryOf(572)
    assert.deepEqual(
      { status: back.status, favorite: back.favorite, deleted: back.deleted },
      { status: before.status, favorite: before.favorite, deleted: undefined },
      `${how}: Undo put back another entry`,
    )
    assert.ok(
      back.updatedAt > marker.updatedAt,
      `${how}: Undo's time, ${back.updatedAt}, isn't after the marker's, ${marker.updatedAt}`,
    )
  }
  await sleep(1500)
  assert.deepEqual(sent, [], 'taking titles off and putting them back asked AniList')
  assert.deepEqual(await browser.evaluate(SAVED_ANSWER), answer, 'My List’s saved answer changed')
})

test('a title taken off in its card and put back there before it closes keeps its cover, which takes focus as the card closes, by Close or Esc', async () => {
  await saveList(TWELVE, '/list?tab=want')
  assert.ok(
    await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 4`, 10_000),
    'My List didn’t show its 4 covers in Want to try',
  )
  const cover = `document.querySelector('#main .ab-strip-panel[href="/anime/572"]')`
  for (const how of ['Close', 'Esc']) {
    await removeInCard(572, /Nausica/)
    await press('Want to try')
    assert.ok(
      await browser.waitFor(`!${UNDO}`, 2000),
      `${how}: the Undo stayed once the title was back`,
    )
    if (how === 'Close')
      await browser.evaluate(`document.querySelector('dialog[open] .ab-close').click(); true`)
    else await browser.press('Escape')
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog[open]')`, 5000),
      `${how}: the card stayed open`,
    )
    assert.deepEqual(await browser.evaluate(SLOTS), ['154587', '21', '572', '97940'], how)
    assert.ok(
      await browser.waitFor(`document.activeElement === ${cover}`, 2000),
      `${how}: focus went to ${await browser.evaluate(`document.activeElement.tagName`)}, not the cover`,
    )
  }
})

test('the Undo has no timer, and a change of tab or filter clears it', async () => {
  await saveList(TWELVE, '/list?tab=want')
  assert.ok(
    await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 4`, 10_000),
    'My List didn’t show its 4 covers in Want to try',
  )
  await removeInCard(21, /ONE PIECE/i)
  await browser.evaluate(`document.querySelector('dialog[open] .ab-close').click(); true`)
  assert.ok(
    await browser.waitFor(`!document.querySelector('dialog[open]') && ${UNDO}`, 5000),
    'no Undo once the card closed',
  )
  await follow('Favorites only', '/list?tab=want&fav=1')
  await follow('Favorites only', '/list?tab=want')
  assert.deepEqual(await browser.evaluate(SLOTS), ['154587', '572', '97940'], 'after the filter')

  // A minute on, on a clock the check moves itself (see Browser.stopClock), the Undo is still
  // there, with focus on it. Chrome can't start the clock again, so in a browser of its own.
  const still = await Browser.open()
  try {
    await still.load({ ...DESKTOP, reduceMotion: true, url: at('/list') })
    await writeList(TWELVE, still)
    await still.load({ ...DESKTOP, reduceMotion: true, url: at('/list?tab=want') })
    assert.ok(
      await still.waitFor(`document.querySelectorAll(${COVERS}).length === 4`, 10_000),
      'the second browser didn’t show the 4 covers',
    )
    await still.evaluate(
      `document.querySelector('#main .ab-strip-panel[href="/anime/97940"]').click(); true`,
    )
    assert.ok(await still.waitFor(`/Black Clover/i.test(${CARD})`, 5000), 'no card opened')
    await still.evaluate(
      `document.querySelector('dialog[open] .ab-mylist [aria-pressed="true"]:not(.ab-heart)').click(); true`,
    )
    await still.evaluate(`document.querySelector('dialog[open] .ab-close').click(); true`)
    assert.ok(
      await still.waitFor(`!document.querySelector('dialog[open]') && ${UNDO}`, 5000),
      'no Undo once the card closed',
    )
    await still.stopClock()
    await still.tick(61_000)
    assert.deepEqual(
      await still.evaluate(`({ row: ${SLOTS}, focused: document.activeElement === ${UNDO} })`),
      { row: ['154587', '21', '572', 'Removed from Want to try. Undo'], focused: true },
      'a minute on',
    )
  } finally {
    await still.close()
  }
})

// My List's status line, over its titles, and the line about titles AniList's answer left out,
// under them, with its button.
const NOTE = `document.querySelector('#main .ab-strip .ab-note').textContent`
const LOST = `document.querySelector('#main .ab-list-lost')?.textContent ?? null`
// What My List's own line for screen readers last said.
const SAID = `document.querySelector('#main > .ab-list > [role="status"]').textContent`
const FAILED =
  'AniList, where AniBeam gets its anime, isn’t responding right now. It’s not something you did. Try again in a minute.'
/** Answers My List's request with `status`, as AniList fails, and every other as recorded. */
const failList = (status: number) => (request: Answer['request']) =>
  request.query === QUERIES.list
    ? { ...listAnswer([]), status, body: { data: null, errors: [{ message: 'No', status }] } }
    : null

test('a title AniList’s answer leaves out keeps its place with no details, the page says how many, and Remove them takes them off in one edit, asking for nothing', async () => {
  // Neon Genesis Evangelion left out, as AniList leaves out a title it no longer has, and ONE
  // PIECE, in Want to try, which the Saved tab doesn't show.
  const asked = await noteRequests((request) =>
    request.query === QUERIES.list ? listAnswer([154587, 1]) : null,
  )
  try {
    await saveList([...SAVED.map((id) => ({ id })), { id: 21, status: 'WANT' }])
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 2`, 10_000),
      'My List didn’t show the 2 titles AniList gave',
    )
    assert.deepEqual(
      await browser.evaluate(`({ row: ${SLOTS}, lost: ${LOST} })`),
      {
        row: ['154587', '1', 'Details unavailable'],
        lost: '1 title couldn’t be shown. Remove them',
      },
      'with one title left out',
    )
    const shift = await browser.layoutShift()
    assert.equal(
      shift.value.toFixed(4),
      '0.0000',
      `as the answer came: ${JSON.stringify(shift.shifts)}`,
    )
    asked.length = 0
    const button = `document.querySelector('#main .ab-list-lost button')`
    await browser.evaluate(`${button}.focus(); ${button}.click(); true`)
    assert.ok(await browser.waitFor(`!${LOST}`, 2000), 'the line stayed after Remove them')
    assert.deepEqual(
      await browser.evaluate(
        `({ row: ${SLOTS}, focused: document.activeElement.id, said: ${SAID} })`,
      ),
      { row: ['154587', '1'], focused: 'ab-list', said: 'Removed from My List' },
      'after Remove them',
    )
    assert.equal((await entryOf(30)).deleted, true, 'Neon Genesis Evangelion has no delete marker')
    assert.equal((await entryOf(1)).deleted, undefined, 'a title AniList gave was taken off')
    // Only the view's: ONE PIECE, never shown in Saved, stays, and Want to try offers it.
    assert.equal((await entryOf(21)).deleted, undefined, 'a title in Want to try was taken off')
    await follow('Want to try', '/list?tab=want')
    assert.deepEqual(
      await browser.evaluate(`({ row: ${SLOTS}, lost: ${LOST} })`),
      { row: ['Details unavailable'], lost: '1 title couldn’t be shown. Remove them' },
      'in Want to try',
    )
    await sleep(1500)
    assert.deepEqual(asked, [], 'Remove them asked AniList')

    // Two left out of three.
    await browser.rewriteAniList(({ request }) =>
      request.query === QUERIES.list ? listAnswer([1]) : null,
    )
    await saveList(SAVED.map((id) => ({ id })))
    assert.ok(
      await browser.waitFor(`${LOST} === '2 titles couldn’t be shown. Remove them'`, 10_000),
      `with two left out: ${await browser.evaluate(LOST)}`,
    )
    assert.deepEqual(await browser.evaluate(SLOTS), [
      'Details unavailable',
      '1',
      'Details unavailable',
    ])
  } finally {
    await browser.rewriteAniList(null)
  }
})

test('a failed answer (500) leaves out no title: none is offered for removal or taken off, and Try again shows', async () => {
  await browser.rewriteAniList(({ request }) => failList(500)(request))
  try {
    await saveList(SAVED.map((id) => ({ id })))
    // A server error is retried after 1, 2 and 4 seconds (see shouldRetry).
    assert.ok(
      await browser.waitFor(`document.querySelector('#main .ab-retry')`, 20_000),
      'no Try again after the answer failed',
    )
    assert.deepEqual(
      await browser.evaluate(`({ row: ${SLOTS}, lost: ${LOST}, note: ${NOTE} })`),
      { row: SAVED.map(() => 'Details unavailable'), lost: null, note: FAILED },
      'after the failed answer',
    )
    for (const id of SAVED) assert.equal((await entryOf(id)).deleted, undefined, `${id} went`)
  } finally {
    await browser.rewriteAniList(null)
  }
})

test('with AniList out of reach (403), the sample titles on the list fill in their places, with the outage line, never saved as its answer', async () => {
  await browser.rewriteAniList(({ request }) => failList(403)(request))
  try {
    await saveList(TWELVE)
    // Cowboy Bebop, Neon Genesis Evangelion, AKIRA and Totoro are samples.
    const saved = SAVED_8.map((id) =>
      [1, 30, 47, 523].includes(id) ? String(id) : 'Details unavailable',
    )
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 4`, 10_000),
      'My List didn’t show its 4 samples in Saved',
    )
    assert.deepEqual(
      await browser.evaluate(`({ row: ${SLOTS}, lost: ${LOST}, note: ${NOTE} })`),
      { row: saved, lost: null, note: `${FAILED} Sample titles fill in what they can.` },
      'Saved, out of reach',
    )
    assert.ok(await browser.evaluate(`Boolean(document.querySelector('#main .ab-retry'))`))
    await follow('Want to try', '/list?tab=want')
    assert.deepEqual(await browser.evaluate(SLOTS), [
      '154587',
      'Details unavailable',
      'Details unavailable',
      'Details unavailable',
    ])
    // Long enough for the saved copy to have been written.
    await sleep(1500)
    assert.equal(
      await browser.evaluate(SAVED_ANSWER),
      undefined,
      'the samples were saved as the answer',
    )
  } finally {
    await browser.rewriteAniList(null)
  }
})

const DAY = 24 * 60 * 60 * 1000
const goOffline = (offline: boolean) =>
  browser.send('Network.emulateNetworkConditions', {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
/** Goes to `path` as the page's own links do, with no new page (see route.ts's push). */
const goTo = (path: string) =>
  browser.evaluate(
    `history.pushState(null, '', ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent('popstate')); true`,
  )

test('offline, My List shows the answer saved 2 days before; with none saved, each title says its details are unavailable offline, until the connection is back', async () => {
  try {
    await saveList(TWELVE)
    assert.ok(
      await browser.waitFor(`${SAVED_ANSWER}?.ids.length === 12`, 10_000),
      'My List’s answer wasn’t saved',
    )
    // Two days on: the answer saved then, past its 6 hours, kept as long as a list is (keptFor).
    await browser.evaluate(`(() => {
      const saved = JSON.parse(localStorage.getItem('anibeam:cache'))
      for (const query of saved.clientState.queries) query.state.dataUpdatedAt -= 2 * ${DAY}
      localStorage.setItem('anibeam:cache', JSON.stringify(saved))
      return true
    })()`)
    // A visit that asks for no list: Frieren's card, at its address, holds Discover's lists back.
    await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/anime/154587') })
    assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000), 'no card opened')
    sent.length = 0
    await goOffline(true)
    await goTo('/list?tab=want')
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 4`, 5000),
      `offline, My List didn’t show its 4 covers in Want to try: ${JSON.stringify(await browser.evaluate(SLOTS))}`,
    )
    assert.deepEqual(
      await browser.evaluate(`({ row: ${SLOTS}, note: ${NOTE} })`),
      { row: WANT_4.map(String), note: 'Offline: waiting for a connection.' },
      'offline, 2 days on',
    )

    // Nothing saved but the list. Back online, the page asks for the list again first.
    await goOffline(false)
    await browser.forget()
    await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/list') })
    await writeList(TWELVE)
    sent.length = 0
    await goOffline(true)
    // Discover, then My List again, which takes the list as it opens.
    await goTo('/')
    await goTo('/list?tab=want')
    assert.ok(
      await browser.waitFor(
        `document.querySelectorAll('#main .ab-strip-words').length === 4`,
        5000,
      ),
      `offline with nothing saved: ${JSON.stringify(await browser.evaluate(SLOTS))}`,
    )
    assert.deepEqual(
      await browser.evaluate(`({ row: ${SLOTS}, note: ${NOTE}, lost: ${LOST} })`),
      {
        row: WANT_4.map(() => 'Details unavailable offline'),
        note: 'Offline: waiting for a connection.',
        lost: null,
      },
      'offline with nothing saved',
    )
    assert.deepEqual(sent, [], 'offline, the page sent AniList a request')
    await goOffline(false)
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 4`, 10_000),
      'back online, My List didn’t show its 4 covers',
    )
    assert.deepEqual(await browser.evaluate(SLOTS), WANT_4.map(String))
  } finally {
    await goOffline(false)
  }
})

// What the page's first draw put in its #main: its heading, or 'nothing'. A MutationObserver, in
// place before the page's own scripts run, hears React's first commit, which draws the whole tree
// in one go, before the browser could paint it, so this needs no luck with frames.
const FIRST_DRAW = `new MutationObserver((_, observer) => {
  const main = document.querySelector('#main')
  if (!main) return
  window.__firstDraw = main.querySelector('h1')?.firstChild.textContent ?? 'nothing'
  observer.disconnect()
}).observe(document, { childList: true, subtree: true })`

test('a visit that starts on My List, or at a card opened over it, draws My List in its first draw, never the header and footer alone', async () => {
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: FIRST_DRAW,
  })
  await noteRequests(answerList)
  try {
    const drawn: Record<string, unknown> = {}
    await browser.forget()
    await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/list') })
    drawn['an empty list'] = await browser.evaluate('window.__firstDraw')
    await openList(SAVED)
    drawn['3 titles'] = await browser.evaluate('window.__firstDraw')
    await browser.evaluate(
      `document.querySelector('#main .ab-strip-panel[href="/anime/154587"]').click(), true`,
    )
    assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 5000), 'no card opened')
    await reload()
    assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 5000), 'no card after the reload')
    drawn['a card over it, reloaded'] = await browser.evaluate('window.__firstDraw')
    assert.deepEqual(drawn, {
      'an empty list': 'My List',
      '3 titles': 'My List',
      'a card over it, reloaded': 'My List',
    })
  } finally {
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    await browser.rewriteAniList(null)
  }
})

// Whether the page has downloaded My List's page, a file of its own (see features/list/page.ts):
// ListPage.tsx as the development server serves it, ListPage-<hash>.js as a build names it.
const PAGE_LOADED = `performance.getEntriesByType('resource').some((entry) => /\\/ListPage[.-]/.test(entry.name))`

test('a title saved on Discover has My List’s page load in the background, so offline, My List opens with no new page, drawn from what is saved', async () => {
  await noteRequests(answerList)
  try {
    await browser.forget()
    await browser.load({ ...DESKTOP, reduceMotion: true })
    assert.ok(await browser.titlesShown(), 'Discover showed no titles')
    assert.ok(
      await browser.waitFor(
        `(localStorage.getItem('anibeam:cache') ?? '').includes('Cowboy Bebop')`,
      ),
      'Discover’s lists weren’t saved',
    )
    // Nothing on the list yet: Discover never downloads the page.
    await sleep(1000)
    assert.equal(await browser.evaluate(PAGE_LOADED), false, 'an empty list loaded My List’s page')
    // Saved from a trending title's card, which closes again.
    const id = await browser.evaluate<number>(
      `Number(document.querySelector('.ab-grid .ab-link').getAttribute('href').slice('/anime/'.length))`,
    )
    await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(), true`)
    assert.ok(await browser.waitFor(CARD, 5000), 'no card opened')
    await press('Save')
    await browser.press('Escape')
    assert.ok(await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000))
    assert.ok(
      await browser.waitFor(PAGE_LOADED, 5000),
      'My List’s page didn’t load once a title was saved',
    )
    // Long enough for what it imports to have come too.
    await sleep(1000)
    sent.length = 0
    await browser.evaluate(`window.__samePage = true`)
    await goOffline(true)
    await goTo('/list')
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 1`, 5000),
      `offline, My List didn’t show its cover: ${JSON.stringify(await browser.evaluate(UNDER))}`,
    )
    assert.deepEqual(
      await browser.evaluate(
        `({ under: ${UNDER}, row: ${SLOTS}, note: ${NOTE}, samePage: window.__samePage === true })`,
      ),
      {
        under: { heading: 'My List', trending: false },
        row: [String(id)],
        note: 'Offline: waiting for a connection.',
        samePage: true,
      },
      'offline, My List opened from Discover',
    )
    assert.deepEqual(sent, [], 'offline, the page sent AniList a request')
    // Back online, the page asks for the list, as it has no answer for it.
    await goOffline(false)
    assert.ok(
      await browser.waitFor(`${SAVED_ANSWER}?.ids.length === 1`, 10_000),
      'back online, My List’s answer wasn’t saved',
    )
  } finally {
    await goOffline(false)
    await browser.rewriteAniList(null)
  }
})

test('offline before My List’s page ever loaded, its place says so, and the page draws as the connection comes back', async () => {
  try {
    // Nothing on the list, so nothing loaded the page.
    await browser.forget()
    await browser.load({ ...DESKTOP, reduceMotion: true })
    assert.ok(await browser.titlesShown(), 'Discover showed no titles')
    assert.equal(await browser.evaluate(PAGE_LOADED), false, 'an empty list loaded My List’s page')
    await goOffline(true)
    await goTo('/list')
    assert.ok(
      await browser.waitFor(`document.querySelector('#main h1')`, 5000),
      'offline, nothing showed in My List’s place',
    )
    assert.deepEqual(
      await browser.evaluate(`({
        under: ${UNDER},
        note: ${NOTE},
        retry: [...document.querySelectorAll('#main button')].map((button) => button.textContent),
      })`),
      {
        under: { heading: 'My List', trending: false },
        note: 'Details unavailable offline',
        retry: ['Try again'],
      },
      'offline, before the page ever loaded',
    )
    // Its heading stands where the page's will, so the page doesn't move it as it draws.
    const headingTop = `Math.round(document.querySelector('#main h1').getBoundingClientRect().top + scrollY)`
    const offlineTop = await browser.evaluate<number>(headingTop)
    await goOffline(false)
    assert.ok(
      await browser.waitFor(`document.querySelector('#main .ab-list-empty')`, 10_000),
      'back online, My List didn’t draw',
    )
    assert.deepEqual((await browser.evaluate<Page>(PAGE)).empty, [
      'Nothing saved yet.',
      'Browse what’s trending /#ab-trending',
    ])
    assert.equal(
      offlineTop - (await browser.evaluate<number>(headingTop)),
      0,
      'px My List’s heading moved by as the page drew',
    )
  } finally {
    await goOffline(false)
  }
})

test('typing in the header search on My List goes to Discover, at /, and shows the results there, with no new page; Back returns to My List', async () => {
  await noteRequests(answerList)
  try {
    await openList(SAVED)
    await browser.evaluate(`window.__samePage = true`)
    await browser.search('frieren')
    assert.ok(
      await browser.waitFor(
        `location.pathname === '/' && document.querySelectorAll('#main .ab-results .ab-strip-panel[href]').length > 0`,
        10_000,
      ),
      `typing on My List: ${await where()}`,
    )
    assert.deepEqual(
      await browser.evaluate(`({
        address: location.pathname + location.search,
        heading: document.querySelector('#main h1')?.firstChild.textContent,
        samePage: window.__samePage === true,
      })`),
      { address: '/', heading: 'Results for “frieren”', samePage: true },
      'after typing on My List',
    )
    // Back on My List, with the search still in the box, it stays there until the box changes.
    await browser.evaluate(`history.back(); true`)
    assert.ok(await browser.waitFor(`location.pathname === '/list'`, 5000), 'Back went elsewhere')
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === ${SAVED.length}`),
      'Back didn’t show My List',
    )
    await sleep(1000)
    assert.deepEqual(await browser.evaluate(UNDER), { heading: 'My List', trending: false })
    assert.equal(await where(), '/list', 'My List sent the visitor away again')
  } finally {
    await browser.rewriteAniList(null)
  }
})
