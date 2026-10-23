// My List's page (spec §3.0, §3F), at /list: its own address, which shows My List in place of
// Discover and asks AniList for none of Discover's lists, also under a title's card opened over it;
// its tabs and Favorites only, links that change the address (?tab=want, &fav=1); and its titles,
// asked for in one request. The 12 titles of the list-12 recording (see LISTS in recordings.ts) are
// answered as AniList answered them; any other list's answer is built here from titles already
// recorded, with a rewrite, as the plan's D19 allows: a 200 needs no recording.
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
 * on the site's page open now: the next load reads it.
 */
async function writeList(entries: Saved[]) {
  await browser.evaluate(`(() => {
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
    await browser.evaluate(`document.querySelector('#main .ab-list-empty a').click(); true`)
    assert.ok(await browser.waitFor(`location.search === ''`), 'Show all went elsewhere')
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 1`, 10_000),
      'Show all didn’t show the 1 Saved title',
    )
    assert.deepEqual((await browser.evaluate<Page>(PAGE)).empty, [])
  } finally {
    await browser.rewriteAniList(null)
  }
})

test('with more than 50 titles, My List asks for the 50 most lately changed, and says so', async () => {
  const fiftyFive = [...RECORDED.keys()].slice(0, 55)
  const asked: Answer['request'][] = []
  await browser.rewriteAniList(({ request }) => {
    asked.push(request)
    return answerList(request)
  })
  try {
    await saveList(fiftyFive.map((id) => ({ id })))
    assert.ok(
      await browser.waitFor(`document.querySelectorAll(${COVERS}).length === 50`, 10_000),
      'My List didn’t show 50 covers',
    )
    const page = await browser.evaluate<Page>(PAGE)
    assert.deepEqual(
      { covers: page.covers, notes: page.notes, saved: page.links[0][0] },
      {
        covers: fiftyFive.slice(0, 50),
        notes: ['Order: Recently changed', 'Showing your 50 most recent.', NOTES[1]],
        saved: 'Saved 55',
      },
    )
    assert.deepEqual(asked, [
      { query: QUERIES.list, variables: { ids: fiftyFive.slice(0, 50).toSorted((a, b) => a - b) } },
    ])
  } finally {
    await browser.rewriteAniList(null)
  }
})
