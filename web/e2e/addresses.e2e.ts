// A title's own address (spec §3.0): /anime/:id opens that title's card over Discover, a typed or
// shared link included, and closing it puts / back.
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { QUERIES } from '../src/features/anime/queries.ts'
import { BASE_URL, Browser, type Answer } from './browser.ts'
import { recordings } from './recordings.ts'

// An id AniList has no anime for, and its answer, as AniList gives it for a missing or an adult
// title: kept beside the recordings for this file alone, as the recorder keeps only 200s.
const MISSING = 99999999
const NOT_FOUND = {
  request: { query: QUERIES.title, variables: { id: MISSING } },
  status: 404,
  body: { data: { Media: null }, errors: [{ message: 'Not Found.', status: 404 }] },
}

let browser: Browser
before(async () => {
  browser = await Browser.open({ recordings: [...recordings().values(), NOT_FOUND] })
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

const PHONE = { width: 390, height: 844, phone: true }
const DESKTOP = { width: 1440, height: 900 }
const at = (path: string) => new URL(path, BASE_URL).href

// The open title card's heading, or '' with none open.
const CARD = `document.querySelector('dialog.ab-card[open] #ab-card-title')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`
// The note shown in place of a card, and its buttons, or null with none open.
const NOTICE = `(() => {
  const notice = document.querySelector('dialog.ab-notice[open]')
  return notice && {
    text: notice.querySelector('.ab-notice-text').textContent,
    // Screen readers hear the text change, as it does from retrying to failed.
    live: notice.querySelector('.ab-notice-text').getAttribute('aria-live'),
    buttons: [...notice.querySelectorAll('button')].map((button) => button.textContent.trim()),
    focused: notice.contains(document.activeElement) && document.activeElement.textContent.trim(),
  }
})()`
const where = () => browser.evaluate<string>(`location.pathname + location.search + location.hash`)

test('a visit to a title’s address opens its card over the page, with or without a last slash, and again on a refresh', async () => {
  for (const path of ['/anime/154587', '/anime/154587/']) {
    await browser.load({ ...DESKTOP, reduceMotion: true, url: at(path) })
    assert.ok(
      await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000),
      `${path} opened no card for Frieren`,
    )
    assert.equal(await where(), path, 'the address stays as it was while the card is open')
    // Over Discover: the page is behind it, as a visit to / shows it.
    assert.ok(
      await browser.evaluate(
        `Boolean(document.querySelector('.ab-top') && document.getElementById('ab-trending'))`,
      ),
    )
    await browser.send('Page.reload')
    await browser.waitFor(`document.readyState === 'complete'`)
    assert.ok(
      await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000),
      `${path} refreshed opened no card`,
    )
  }
})

test('closing a card opened at its address, by its button or Esc, puts / in the address bar, in place of the title’s', async () => {
  for (const [how, reduceMotion] of [
    ['button', true],
    ['Esc', false],
  ] as const) {
    await browser.load({ ...DESKTOP, reduceMotion, url: at('/anime/154587') })
    assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000))
    await browser.animationsDone()
    // Set on this page: still there after closing, so the page didn't load again.
    await browser.evaluate(`window.__stayed = history.length; true`)
    if (how === 'button')
      await browser.evaluate(`document.querySelector('.ab-close').click(); true`)
    else await browser.press('Escape')
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog[open]')`, 5000),
      `closed by its ${how}, the card stayed open`,
    )
    // The address changes as the dialog's close event arrives, a moment after it closes.
    await browser.waitFor(`location.pathname === '/'`, 2000)
    assert.equal(await where(), '/', `closed by its ${how}`)
    assert.ok(
      await browser.evaluate(`window.__stayed === history.length`),
      'closing loaded the page again or added a history entry',
    )
  }
})

test('a title AniList doesn’t have says so in place of its card, with Close and no Try again, and Close puts / back', async () => {
  await browser.load({ ...PHONE, reduceMotion: true, url: at(`/anime/${MISSING}`) })
  assert.ok(await browser.waitFor(NOTICE, 10_000), 'no note showed')
  const notice = await browser.evaluate<{
    text: string
    live: string
    buttons: string[]
    focused: string
  }>(NOTICE)
  assert.deepEqual(notice, {
    text: 'We couldn’t find that title.',
    live: 'polite',
    buttons: ['Close'],
    focused: 'Close',
  })
  assert.equal(await browser.evaluate(CARD), '', 'a card opened all the same')
  await browser.evaluate(`document.querySelector('dialog.ab-notice button').click(); true`)
  assert.ok(await browser.waitFor(`!document.querySelector('dialog[open]')`, 5000))
  await browser.waitFor(`location.pathname === '/'`, 2000)
  assert.equal(await where(), '/')
})

test('a title AniList fails to give says why, as a section does, and Try again brings its card', async () => {
  // A server error, retried after 1, 2 and 4 seconds, then given up on.
  await browser.rewriteAniList(({ request }) =>
    request.variables.id === 154587
      ? {
          status: 500,
          body: { data: null, errors: [{ message: 'Internal Server Error', status: 500 }] },
        }
      : null,
  )
  try {
    // Opened in an earlier check, Frieren is saved, fresh for 30 days: it would open with no request.
    await browser.forget()
    await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/anime/154587') })
    assert.ok(
      await browser.waitFor(`${NOTICE}?.text.includes('Trying again in a few seconds')`, 10_000),
      'no note while AniList retried',
    )
    assert.ok(
      await browser.waitFor(`${NOTICE}?.buttons.includes('Try again')`, 20_000),
      'no Try again',
    )
    assert.match(
      (await browser.evaluate<{ text: string }>(NOTICE)).text,
      /isn’t responding right now\. It’s not something you did\. Try again in a minute\./,
    )
  } finally {
    await browser.rewriteAniList(null)
  }
  await browser.evaluate(
    `[...document.querySelectorAll('dialog.ab-notice button')].find((b) => b.textContent === 'Try again').click(); true`,
  )
  assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000), 'Try again brought no card')
  assert.equal(await browser.evaluate(NOTICE), null)
})

test('an address the app doesn’t know becomes /, keeping its query and hash, with no card', async () => {
  for (const [path, becomes] of [
    ['/nope', '/'],
    ['/anime/0154587', '/'],
    ['/anime/154587/chat', '/'],
    ['/a/b?x=1#decades', '/?x=1#decades'],
  ]) {
    await browser.load({ ...DESKTOP, reduceMotion: true, url: at(path) })
    assert.ok(await browser.waitFor(`location.pathname === '/'`, 5000), `${path} stayed`)
    assert.equal(await where(), becomes, path)
    await sleep(300)
    assert.equal(
      await browser.evaluate(`document.querySelector('dialog[open]')`),
      null,
      `${path} opened a card`,
    )
  }
})

test('a first visit to a title’s address moves nothing on the page, with AniList’s answers held 2 s', async () => {
  const seen: string[] = []
  for (const screen of [PHONE, DESKTOP])
    for (const reduceMotion of [false, true]) {
      await browser.forget()
      await browser.holdAniList(2000)
      try {
        await browser.load({ ...screen, reduceMotion, url: at('/anime/154587') })
        assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 15_000))
        await browser.animationsDone()
        await sleep(1000)
      } finally {
        await browser.holdAniList(0)
      }
      const { value } = await browser.layoutShift()
      if (value >= 0.1)
        seen.push(`${screen.width}px${reduceMotion ? ', reduced motion' : ''}: ${value.toFixed(4)}`)
    }
  assert.deepEqual(seen, [], 'a first visit to a title’s address jumps')
})

test('a first visit to a title’s address asks AniList for that title alone, and for the lists, in one request, once it closes', async () => {
  // Each request, as what it asks for: a title by its id, or the lists it asks for.
  const asked: string[] = []
  const what = ({ query, variables }: Answer['request']) =>
    query === QUERIES.title
      ? `title ${variables.id}`
      : query === QUERIES.firstVisit
        ? 'trending + 1990s'
        : JSON.stringify(query.slice(0, 40))
  await browser.forget()
  await browser.rewriteAniList(({ request }) => {
    asked.push(what(request))
    return null
  })
  try {
    await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/anime/154587') })
    assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000))
    // Long enough for the lists to have asked, had they not waited.
    await sleep(1500)
    assert.deepEqual(asked, ['title 154587'], 'while the card is open')
    await browser.evaluate(`document.querySelector('.ab-close').click(); true`)
    assert.ok(await browser.titlesShown(), 'the lists never loaded once the card closed')
    assert.deepEqual(asked, ['title 154587', 'trending + 1990s'], 'once it closed')
  } finally {
    await browser.rewriteAniList(null)
  }
})

test('the tab shows the open card’s title, and the site’s again once it closes', async () => {
  // The page's own title, in index.html.
  const PAGE = "AniBeam · What's hot in anime"
  await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/anime/154587') })
  assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000))
  assert.equal(await browser.evaluate(`document.title`), 'Frieren: Beyond Journey’s End · AniBeam')
  await browser.evaluate(`document.querySelector('.ab-close').click(); true`)
  assert.ok(await browser.waitFor(`!document.querySelector('dialog[open]')`, 5000))
  assert.ok(
    await browser.waitFor(`document.title === ${JSON.stringify(PAGE)}`, 2000),
    await browser.evaluate(`document.title`),
  )
  // Opened from a panel on the page, too.
  assert.ok(await browser.titlesShown())
  await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(); true`)
  assert.ok(await browser.waitFor(`document.querySelector('dialog.ab-card[open]')`, 5000))
  const named = await browser.evaluate<string>(CARD)
  assert.equal(await browser.evaluate(`document.title`), `${named} · AniBeam`)
})

test('every title on the page links to its own address, which opens that same title', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  const LINKS = `[...document.querySelectorAll('.ab-grid .ab-link, .ab-strip-row:not([aria-hidden]) .ab-strip-panel[href]')].map((link) => link.getAttribute('href'))`
  const links = await browser.evaluate<string[]>(LINKS)
  assert.ok(links.length >= 9 + 4, `found ${links.length} title links`)
  const wrong = links.filter((href) => !/^\/anime\/[1-9]\d*$/.test(href))
  assert.deepEqual(wrong, [], 'title links that are not a title’s address')
  // A search's first result, Frieren, opened on the page, then at its link's address (the one
  // title the recordings answer on its own).
  await browser.search('frieren')
  const first = `document.querySelector('.ab-results .ab-strip-panel[href]')`
  assert.ok(await browser.waitFor(first, 10_000), 'no results for frieren')
  const href = await browser.evaluate<string>(`${first}.getAttribute('href')`)
  assert.equal(href, '/anime/154587')
  await browser.evaluate(`${first}.click(); true`)
  assert.ok(await browser.waitFor(`document.querySelector('dialog.ab-card[open]')`, 5000))
  const onPage = await browser.evaluate<string>(CARD)
  await browser.load({ ...DESKTOP, reduceMotion: true, url: at(href) })
  assert.ok(await browser.waitFor(`${CARD} !== ''`, 10_000), `${href} opened no card`)
  assert.equal(await browser.evaluate(CARD), onPage, `${href} opened another title`)
})

test('a click with Ctrl, Cmd, Shift or Alt held is left to the browser, and a plain one opens the card on the page', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  // Clicks a trending panel's link with `keys` held, and says whether the page took the click
  // for itself (cancelled what the browser would do) and opened a card. Heard last, on the
  // window, which then cancels the click itself, so the browser doesn't leave the page.
  const clicked = (keys: object) =>
    browser.evaluate<{ taken: boolean; opened: boolean }>(`(() => {
      let taken
      const hear = (event) => { taken = event.defaultPrevented; event.preventDefault() }
      addEventListener('click', hear, { once: true })
      const link = document.querySelector('.ab-grid .ab-link')
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...${JSON.stringify(keys)} }))
      return { taken, opened: Boolean(document.querySelector('dialog.ab-card[open]')) }
    })()`)
  for (const keys of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])
    assert.deepEqual(await clicked(keys), { taken: false, opened: false }, JSON.stringify(keys))
  await sleep(300)
  assert.equal(await browser.evaluate(`document.querySelector('dialog[open]')`), null)
  // The card opens as React next renders, just after the click.
  assert.equal((await clicked({})).taken, true, 'a plain click')
  assert.ok(await browser.waitFor(`document.querySelector('dialog.ab-card[open]')`, 5000))
})

// Where the page is in its history: the Navigation API's index of the current entry.
const entry = () => browser.evaluate<number>(`navigation.currentEntry.index`)

test('a title opened on the page puts its address in the address bar, from the list with no request; Back closes it and Forward opens it again', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  const asked: string[] = []
  await browser.rewriteAniList(({ request }) => {
    asked.push(JSON.stringify(request.variables))
    return null
  })
  try {
    const start = await entry()
    const href = await browser.evaluate<string>(
      `document.querySelector('.ab-grid .ab-link').getAttribute('href')`,
    )
    await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(); true`)
    assert.ok(await browser.waitFor(`${CARD} !== ''`, 5000), 'no card opened')
    const named = await browser.evaluate<string>(CARD)
    assert.equal(await where(), href, 'the address bar')
    assert.equal(await entry(), start + 1, 'opening added no history entry')
    await browser.evaluate(`history.back(); true`)
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog[open]')`, 5000),
      'Back left the card open',
    )
    assert.equal(await where(), '/')
    await browser.evaluate(`history.forward(); true`)
    assert.ok(await browser.waitFor(`${CARD} !== ''`, 5000), 'Forward opened no card')
    assert.equal(await browser.evaluate(CARD), named, 'Forward opened another title')
    await sleep(500)
    assert.deepEqual(asked, [], 'opening, Back and Forward asked AniList')
  } finally {
    await browser.rewriteAniList(null)
  }
})

test('Close or Esc on a title opened on the page goes Back, so the next Back leaves the page, not the title', async () => {
  for (const [how, reduceMotion] of [
    ['button', true],
    ['Esc', false],
  ] as const) {
    await browser.load({ ...DESKTOP, reduceMotion })
    assert.ok(await browser.titlesShown())
    const start = await entry()
    await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(); true`)
    assert.ok(await browser.waitFor(`${CARD} !== ''`, 5000))
    assert.equal(await entry(), start + 1, 'opening added no history entry')
    await browser.animationsDone()
    if (how === 'button')
      await browser.evaluate(`document.querySelector('.ab-close').click(); true`)
    else await browser.press('Escape')
    assert.ok(
      await browser.waitFor(
        `!document.querySelector('dialog[open]') && location.pathname === '/'`,
        5000,
      ),
      `closed by its ${how}`,
    )
    assert.equal(
      await entry(),
      start,
      `closed by its ${how}, the page stayed a history entry ahead`,
    )
  }
})

test('after a link to a section, a title closed by Close, Esc or Back leaves the visitor’s place and focus as they were', async () => {
  for (const how of ['button', 'Esc', 'Back']) {
    await browser.load({ ...DESKTOP, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    // The header's Decades link leaves #decades in the address; then a little further down.
    await browser.evaluate(`document.querySelector('.ab-nav a[href="#decades"]').click(); true`)
    await browser.waitFor(`location.hash === '#decades'`)
    await browser.evaluate(`scrollBy(0, 120); true`)
    await sleep(200)
    const link = `document.querySelector('.ab-strip-row:not([aria-hidden]) .ab-strip-panel[href]')`
    await browser.evaluate(`${link}.focus({ preventScroll: true }); true`)
    const before = await browser.evaluate<number>(`scrollY`)
    await browser.press('Enter')
    assert.ok(await browser.waitFor(`${CARD} !== ''`, 5000))
    await browser.animationsDone()
    if (how === 'button')
      await browser.evaluate(`document.querySelector('.ab-close').click(); true`)
    else if (how === 'Esc') await browser.press('Escape')
    else await browser.evaluate(`history.back(); true`)
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog') && location.pathname === '/'`, 5000),
      how,
    )
    await sleep(300)
    const after = await browser.evaluate<{ scrollY: number; focused: boolean }>(
      `({ scrollY, focused: document.activeElement === ${link} })`,
    )
    assert.deepEqual(after, { scrollY: before, focused: true }, `closed by ${how}`)
  }
})

test('focus returns to what opened a title however its card goes: Back, or Esc on a card Forward opened again', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  const link = `document.querySelector('.ab-grid .ab-link')`
  await browser.evaluate(`${link}.focus(); true`)
  await browser.press('Enter')
  assert.ok(await browser.waitFor(`${CARD} !== ''`, 5000))
  await browser.evaluate(`history.back(); true`)
  assert.ok(await browser.waitFor(`!document.querySelector('dialog')`, 5000), 'Back left the card')
  assert.ok(await browser.waitFor(`document.activeElement === ${link}`, 1000), 'Back lost focus')
  await browser.evaluate(`history.forward(); true`)
  assert.ok(await browser.waitFor(`${CARD} !== ''`, 5000), 'Forward opened no card')
  await browser.animationsDone()
  await browser.press('Escape')
  assert.ok(await browser.waitFor(`!document.querySelector('dialog')`, 5000), 'Esc left the card')
  assert.ok(await browser.waitFor(`document.activeElement === ${link}`, 1000), 'Esc lost focus')
})

test('a title opened on the page shows its list’s copy, never saved as AniList’s answer for it', async () => {
  // The copy may be a sample, or older than an answer saved for the title: saved under the title,
  // it would pass for AniList's answer, fresh, on the next visit to its address.
  await browser.forget()
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(); true`)
  assert.ok(await browser.waitFor(`${CARD} !== ''`, 5000))
  // The cache is saved at most once a second.
  await sleep(1500)
  const saved = await browser.evaluate<string[]>(`(() => {
    const copy = JSON.parse(localStorage.getItem('anibeam:cache') ?? 'null')
    return (copy?.clientState.queries ?? []).map((query) => String(query.queryKey[1]).slice(0, 30))
  })()`)
  assert.ok(saved.length > 0, 'nothing was saved at all')
  assert.deepEqual(
    saved.filter((query) => query === QUERIES.title.slice(0, 30)),
    [],
    'the title was saved on its own',
  )
})

test('an answer with no title and no error says the title isn’t there, rather than showing nothing', async () => {
  await browser.forget()
  await browser.rewriteAniList(({ request }) =>
    request.variables.id === 154587 ? { status: 200, body: { data: { Media: null } } } : null,
  )
  try {
    await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/anime/154587') })
    assert.ok(
      await browser.waitFor(`${NOTICE}?.text === 'We couldn’t find that title.'`, 10_000),
      'no note showed',
    )
  } finally {
    await browser.rewriteAniList(null)
  }
})

test('closing a title opened on the page asks AniList for nothing, even with the lists out of date', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  // 31 minutes on, by the page's clock: trending, fresh for 30, is out of date.
  await browser.evaluate(
    `(() => { const now = Date.now; Date.now = () => now() + 31 * 60_000; return true })()`,
  )
  const asked: string[] = []
  await browser.rewriteAniList(({ request }) => {
    asked.push(
      request.query.includes('TRENDING_DESC') ? 'trending' : JSON.stringify(request.variables),
    )
    return null
  })
  try {
    await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(); true`)
    assert.ok(await browser.waitFor(`${CARD} !== ''`, 5000))
    await browser.evaluate(`document.querySelector('.ab-close').click(); true`)
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog') && location.pathname === '/'`, 5000),
    )
    await sleep(1500)
    assert.deepEqual(asked, [], 'opening and closing a card asked AniList')
  } finally {
    await browser.rewriteAniList(null)
  }
})

test('a title clicked while a shared one still loads takes its place, so closing it returns to the page', async () => {
  // Saved lists, from a visit to /, show while the shared title loads.
  await browser.forget()
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.holdAniList(4000)
  try {
    await browser.load({ ...DESKTOP, reduceMotion: true, url: at('/anime/154587') })
    assert.ok(
      await browser.waitFor(`document.querySelectorAll('.ab-grid .ab-link').length >= 9`, 3000),
      'no saved titles showed',
    )
    assert.equal(await browser.evaluate(CARD), '', 'Frieren arrived before the click')
    await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(); true`)
    assert.ok(await browser.waitFor(`${CARD} !== ''`, 5000))
    assert.doesNotMatch(await browser.evaluate<string>(CARD), /Frieren/)
    await browser.evaluate(`document.querySelector('.ab-close').click(); true`)
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog') && location.pathname === '/'`, 5000),
      'closing left the page elsewhere',
    )
    // Long enough for Frieren's held answer to have come.
    await sleep(4500)
    assert.equal(
      await browser.evaluate(`document.querySelector('dialog[open]')`),
      null,
      'Frieren’s card came back',
    )
    assert.equal(await where(), '/')
  } finally {
    await browser.holdAniList(0)
  }
})

test('after a reload, closing a title opened on the page puts / in its place rather than loading the site again', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  // Frieren, the one title the recordings answer at its address, from a search.
  await browser.search('frieren')
  const first = `document.querySelector('.ab-results .ab-strip-panel[href]')`
  assert.ok(await browser.waitFor(first, 10_000))
  await browser.evaluate(`${first}.click(); true`)
  assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 5000))
  await browser.send('Page.reload')
  assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000), 'no card after the reload')
  await browser.animationsDone()
  // Set on this page: still there after closing, so the site didn't load again.
  await browser.evaluate(`window.__stayed = true; true`)
  await browser.evaluate(`document.querySelector('.ab-close').click(); true`)
  assert.ok(
    await browser.waitFor(
      `!document.querySelector('dialog[open]') && location.pathname === '/'`,
      5000,
    ),
  )
  await sleep(500)
  assert.equal(
    await browser.evaluate(`window.__stayed === true`),
    true,
    'closing loaded the site again',
  )
})
