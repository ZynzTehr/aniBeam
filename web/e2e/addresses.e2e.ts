// A title's own address (spec §3.0): /anime/:id opens that title's card over Discover, a typed or
// shared link included, and closing it puts / back.
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { QUERIES } from '../src/features/anime/queries.ts'
import { BASE_URL, Browser } from './browser.ts'
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
  const notice = await browser.evaluate<{ text: string; buttons: string[]; focused: string }>(
    NOTICE,
  )
  assert.deepEqual(notice, {
    text: 'We couldn’t find that title.',
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
