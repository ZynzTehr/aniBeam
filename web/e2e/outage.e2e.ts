// A first-time visitor while AniList is unreachable: friendly messages, then Try again.
// Slow on purpose: after a failed connection the AniList client waits a minute before retrying.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { Browser } from './browser.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open() // a fresh profile: nothing saved, like a first visit
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

test('on a phone, the intro holds its covers’ place while they load, so the headline stays put', async () => {
  await browser.holdAniList(3_000)
  await browser.load({ width: 390, height: 844, phone: true })
  const loading = await browser.evaluate<{ covers: number; top: number }>(
    `({ covers: document.querySelectorAll('.ab-intro-art img').length, top: ${headline} })`,
  )
  await browser.holdAniList(0)
  assert.ok(await browser.titlesShown(), 'the titles never came')
  const moved = Math.round((await browser.evaluate<number>(headline)) - loading.top)
  assert.equal(loading.covers, 0, 'the covers came before they could be measured without')
  assert.ok(Math.abs(moved) <= 2, `the headline moved ${moved}px when the covers arrived`)
})

describe('AniList down on a first visit', () => {
  before(async () => {
    await browser.forget()
    await browser.blockAniList()
    await browser.load()
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

  test('on a phone, the intro holds no empty space for covers while AniList fails', async () => {
    await asPhone(true)
    const art = await browser.evaluate<number>(
      `document.querySelector('.ab-intro-art').getBoundingClientRect().height`,
    )
    await asPhone(false)
    // Held for covers that aren't coming, the band pushed the buttons off a small phone's screen.
    assert.ok(art < 100, `the intro holds ${Math.round(art)}px for covers`)
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
    // Focus moves as the button goes, once the page has re-rendered.
    const landed = await browser.waitFor(`document.activeElement.id === 'ab-trending'`, 5_000)
    const focus = await browser.evaluate<string>(
      `document.activeElement.id || document.activeElement.tagName`,
    )
    assert.ok(landed, `focus went to ${focus}, not the section's heading`)
    assert.ok(await browser.titlesShown(120_000), 'the titles did not come back')
    assert.deepEqual(await browser.evaluate(notes), ['', ''])
    assert.equal(await browser.evaluate('document.querySelector(".ab-lever").disabled'), false)
  })
})
