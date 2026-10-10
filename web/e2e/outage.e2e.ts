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

// Covers come from AniList's image server, which a school or office filter can block while its
// API still answers. Chrome then draws its broken-image icon in each cover's box (alt="" doesn't
// stop it). The titles come from the copy the check above saved, so this asks AniList for none.
test('covers that can’t load show no broken-image icon, and each panel shows its title’s color instead', async () => {
  await sleep(1_500) // the saved copy updates a second after the page's last change
  await browser.send('Network.enable')
  await browser.send('Network.setBlockedURLs', { urls: ['*s4.anilist.co*'] })
  try {
    await browser.load()
    assert.ok(await browser.titlesShown(), 'the titles never came')
    // Lazy covers are asked for as they near the screen. A pull and a title card add one each.
    const finished = (selector: string) =>
      `[...document.querySelectorAll('${selector}')].every((img) => img.complete)`
    await browser.evaluate(`document.querySelector('#ab-trending').scrollIntoView(); true`)
    await browser.waitFor(finished('.ab-intro-art img, .ab-grid img'))
    await browser.evaluate(`document.querySelector('#decades').scrollIntoView(); true`)
    await browser.waitFor(`document.querySelector('.ab-strip-row img')?.complete`)
    await browser.evaluate(`document.querySelector('.ab-lever').click(); true`)
    await browser.waitFor(`document.querySelector('.ab-result.is-open img')?.complete`)
    await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(); true`)
    await browser.waitFor(`document.querySelector('dialog.ab-card img')?.complete`)
    // Two frames on, so every failed cover's error event has been handled.
    const covers = await browser.evaluate<{
      failed: string[]
      shown: string[]
      grey: string[]
      intro: number
    }>(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))).then(() => {
      const place = (img) => img.parentElement.closest('[class]').classList[0]
      const failed = [...document.images].filter((img) => img.complete && img.naturalWidth === 0)
      const swatch = document.body.appendChild(document.createElement('i'))
      const rgb = (color) => {
        swatch.style.color = color
        return getComputedStyle(swatch).color
      }
      const grey = [...document.querySelectorAll('.ab-grid .ab-link')].flatMap((link, i) => {
        const fill = getComputedStyle(link).backgroundColor
        const accent = rgb(getComputedStyle(link).getPropertyValue('--anime-accent'))
        return fill === accent ? [] : ['panel ' + (i + 1) + ': ' + fill + ', not ' + accent]
      })
      swatch.remove()
      return {
        failed: [...new Set(failed.map(place))].sort(),
        shown: failed.filter((img) => img.checkVisibility({ visibilityProperty: true })).map(place),
        grey,
        intro: [...document.querySelectorAll('.ab-intro-art img')].filter((img) => img.getClientRects().length).length,
      }
    })`)
    await browser.press('Escape')
    assert.deepEqual(
      covers.failed,
      ['ab-img', 'ab-intro-art', 'ab-result-panel', 'ab-sheet-art', 'ab-strip-panel'],
      'places where no cover failed to load, so they went unchecked',
    )
    assert.deepEqual(covers.shown, [], 'covers that failed to load still show, as broken images')
    assert.deepEqual(covers.grey, [], 'panels that show grey instead of their title’s color')
    assert.equal(covers.intro, 0, 'the intro holds a place for covers that failed to load')
  } finally {
    // Covers load again for the checks below.
    await browser.send('Network.setBlockedURLs', { urls: [] })
    await browser.send('Network.disable')
  }
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
