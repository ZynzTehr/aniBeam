// A first-time visitor while AniList is unreachable: friendly messages, then Try again.
// Slow on purpose: after a failed connection the AniList client waits a minute before retrying.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { Browser } from './browser.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open() // a fresh profile: nothing saved, like a first visit
  await browser.blockAniList()
  await browser.load()
})
after(() => browser?.close())

const notes = `[...document.querySelectorAll('.ab-note')].map((note) => note.textContent)`

// Where the headline sits inside the intro: it must not move when the covers arrive.
const headline = `document.querySelector('.ab-intro-title').getBoundingClientRect().top - document.querySelector('.ab-intro').getBoundingClientRect().top`
const asPhone = async (phone: boolean) => {
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    phone
      ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
      : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  )
  await sleep(400)
}
let headlineWithoutCovers = 0

test('on a phone, the intro holds a place for its covers before they load', async () => {
  await asPhone(true)
  headlineWithoutCovers = await browser.evaluate<number>(headline)
  await asPhone(false)
})

test('while it retries, each section says AniList is not responding and that it is not the visitor', async () => {
  assert.ok(
    await browser.waitFor(
      `${notes}.every((note) => note.includes('Trying again in a minute'))`,
      15_000,
    ),
  )
  const hint = await browser.evaluate<string>(`document.querySelector('.ab-hint').textContent`)
  assert.match(hint, /fills up with titles once AniList answers/)
  assert.equal(await browser.evaluate('document.querySelector(".ab-lever").disabled'), true)
})

test('once retrying fails, every section offers Try again and stops showing loading panels', async () => {
  assert.ok(
    await browser.waitFor(`document.querySelectorAll('.ab-retry').length === 2`, 150_000),
    'no Try again buttons',
  )
  const state = await browser.evaluate<{ notes: string[]; placeholders: number }>(
    `({ notes: ${notes}, placeholders: document.querySelectorAll('.ab-skeleton, .ab-skeleton-fill').length })`,
  )
  for (const note of state.notes)
    assert.match(note, /isn’t responding right now\. It’s not something you did/)
  assert.equal(state.placeholders, 0)
})

test('when AniList is back, one press of Try again brings every section back', async () => {
  await browser.blockAniList(false)
  // Press it from the keyboard: the button disappears while retrying, so focus must land
  // somewhere useful (the section's heading), not fall back to the top of the page.
  await browser.evaluate(`document.querySelector('.ab-page .ab-retry').focus(); true`)
  await browser.press('Enter')
  const focus = await browser.evaluate<string>(
    `document.activeElement.id || document.activeElement.tagName`,
  )
  assert.equal(focus, 'ab-trending', 'focus fell off the pressed Try again button')
  assert.ok(await browser.titlesShown(120_000), 'the titles did not come back')
  assert.deepEqual(await browser.evaluate(notes), ['', ''])
  assert.equal(await browser.evaluate('document.querySelector(".ab-lever").disabled'), false)
})

test('on a phone, the headline stays put when the covers arrive', async () => {
  await asPhone(true)
  const withCovers = await browser.evaluate<number>(headline)
  const moved = Math.round(withCovers - headlineWithoutCovers)
  assert.ok(Math.abs(moved) <= 2, `the headline moved ${moved}px when the covers arrived`)
  await asPhone(false)
})
