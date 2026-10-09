// The Discover page in a real browser: layout, decades, search, the title card, the pull,
// keyboard use, reduced motion and phones. Run with `npm run test:browser` (see browser.ts).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { Browser } from './browser.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open()
})
after(() => browser?.close())

describe('desktop (1440x900)', () => {
  before(async () => {
    await browser.load()
    assert.ok(await browser.titlesShown(), 'trending and decade titles never appeared')
  })

  test('renders the header, intro, nine trending panels, the pull and the decades', async () => {
    const page = await browser.evaluate<{
      h1: string
      links: string[]
      panels: number
      chips: string[]
    }>(`({
      h1: document.querySelector('h1').textContent.replace('キラーン', '').replace(/\\s+/g, ' ').trim(),
      links: [...document.querySelectorAll('.ab-nav a')].map((a) => a.textContent.trim()),
      panels: document.querySelectorAll('.ab-grid .ab-link').length,
      chips: [...document.querySelectorAll('.ab-eras input')].map((input) => input.value),
    })`)
    assert.equal(page.h1, 'What’s hot. What’s new. Talk about it.')
    assert.deepEqual(page.links, ['Trending', 'Pull', 'Decades'])
    assert.equal(page.panels, 9)
    assert.deepEqual(page.chips, [
      'pre-1970',
      '1970s',
      '1980s',
      '1990s',
      '2000s',
      '2010s',
      '2020s',
      'upcoming',
    ])
  })

  test('the intro fills the first screen, and status lines stay quiet once titles show', async () => {
    const state = await browser.evaluate<{ trendingTop: number; notes: string[] }>(`({
      trendingTop: document.querySelector('.ab-page').getBoundingClientRect().top,
      notes: [...document.querySelectorAll('.ab-note')].map((note) => note.textContent),
    })`)
    assert.ok(state.trendingTop >= 899, `trending starts at ${state.trendingTop}px`)
    assert.deepEqual(state.notes, ['', ''])
  })

  test('later features show as coming soon and cannot be used', async () => {
    const soon = await browser.evaluate<{
      menu: string
      tabIndex: number
      hint: string
      intro: string
    }>(`({
      menu: document.querySelector('.ab-nav .ab-soon').textContent.replace(/\\s+/g, ' ').trim(),
      tabIndex: document.querySelector('.ab-nav .ab-soon').tabIndex,
      hint: document.querySelector('.ab-hint').textContent,
      intro: document.querySelector('.ab-intro-lede').textContent,
    })`)
    assert.equal(soon.menu, 'My List Soon')
    assert.equal(soon.tabIndex, -1)
    assert.match(soon.hint, /Coming soon: mood sliders/)
    assert.match(soon.intro, /Coming soon: chat with other fans/)
  })

  test('the first Tab reaches a visible skip link that jumps to the page', async () => {
    await browser.evaluate('document.activeElement.blur(); scrollTo(0, 0); true')
    await browser.press('Tab')
    const skip = await browser.evaluate<{ text: string; shown: boolean }>(
      `({ text: document.activeElement.textContent.trim(), shown: getComputedStyle(document.activeElement).transform === 'none' })`,
    )
    assert.deepEqual(skip, { text: 'Skip to content', shown: true })
    await browser.press('Enter')
    assert.equal(await browser.evaluate('location.hash'), '#main')
  })

  test('picking the 1980s chip swaps the strip to 1980s titles', async () => {
    const first = `document.querySelector('.ab-strip-row .ab-strip-panel[href] .ab-strip-title')?.textContent`
    const nineties = await browser.evaluate<string>(first)
    await browser.evaluate(`document.querySelector('.ab-eras input[value="1980s"]').click(); true`)
    assert.ok(
      await browser.waitFor(`${first} && ${first} !== ${JSON.stringify(nineties)}`),
      'the strip kept the 1990s titles',
    )
    assert.equal(
      await browser.evaluate(`document.querySelector('.ab-eras input:checked').value`),
      '1980s',
    )
  })

  test('searching shows results in place of the intro, and Esc returns focus to the opened result', async () => {
    await browser.search('frieren')
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-results .ab-strip-panel[href]')`),
      'no results appeared',
    )
    const results = await browser.evaluate<{
      heading: string
      first: string
      intro: boolean
      scrollY: number
    }>(`({
      heading: document.querySelector('.ab-results h2, .ab-results h1').textContent.replace('サーチ!', '').trim(),
      first: document.querySelector('.ab-results .ab-strip-title').textContent,
      intro: Boolean(document.querySelector('.ab-intro')),
      scrollY,
    })`)
    assert.equal(results.heading, 'Results for “frieren”')
    assert.match(results.first, /Frieren/i)
    assert.equal(results.intro, false)
    assert.equal(results.scrollY, 0)

    await browser.evaluate(
      `document.querySelector('.ab-results .ab-strip-panel[href]').focus(); true`,
    )
    await browser.press('Enter')
    assert.ok(
      await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5_000),
      'the title card did not open',
    )
    await sleep(1_800)
    const card = await browser.evaluate<{ title: string; soon: string[] }>(`({
      title: document.querySelector('#ab-card-title').textContent.replace(/\\s+/g, ' ').trim(),
      soon: [...document.querySelectorAll('.ab-card button.ab-soon')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim() + (b.disabled ? ' (disabled)' : '')),
    })`)
    assert.match(card.title, /Frieren/i)
    assert.deepEqual(card.soon, [
      'Save to My List Soon (disabled)',
      'Chat about it Soon (disabled)',
    ])
    await browser.press('Escape')
    await sleep(400)
    const back = await browser.evaluate<{ open: boolean; focus: string }>(
      `({ open: Boolean(document.querySelector('dialog.ab-card')), focus: document.activeElement.className })`,
    )
    assert.deepEqual(back, { open: false, focus: 'ab-strip-panel' })
  })

  test('a search with no matches says so, and clearing it brings the intro back', async () => {
    await browser.search('zzqqxxnotananime')
    assert.ok(
      await browser.waitFor(
        `document.querySelector('.ab-results .ab-note')?.textContent === 'No titles found.'`,
      ),
      'no "No titles found." line',
    )
    await browser.search('')
    assert.ok(
      await browser.waitFor(
        `document.querySelector('.ab-intro') && !document.querySelector('.ab-results')`,
        5_000,
      ),
      'the intro did not come back',
    )
  })

  test('a new search never shows the previous search’s titles while it loads', async () => {
    const titles = `[...document.querySelectorAll('.ab-results .ab-strip-panel[href] .ab-strip-title')].map((t) => t.textContent).join(' | ')`
    await browser.search('frieren')
    assert.ok(await browser.waitFor(`/Frieren/i.test(${titles})`), 'no Frieren results')
    await browser.search('')
    await browser.holdAniList(3_000)
    await browser.search('mushishi')
    assert.ok(
      await browser.waitFor(
        `document.querySelector('#results')?.textContent.includes('mushishi')`,
        5_000,
      ),
      'the results heading never switched to the new search',
    )
    const whileLoading = await browser.evaluate<string>(titles)
    await browser.holdAniList(0)
    assert.doesNotMatch(
      whileLoading,
      /Frieren/i,
      'the cleared search’s titles came back under the new heading',
    )
    assert.ok(await browser.waitFor(`/mushi-?shi/i.test(${titles})`), 'no Mushishi results') // English title: MUSHI-SHI
    await browser.search('')
  })

  test('the lever pulls a real title from the page', async () => {
    await browser.evaluate(
      `document.querySelector('#pull').scrollIntoView(); document.querySelector('.ab-lever').click(); true`,
    )
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-result.is-open h3')?.textContent`, 5_000),
      'nothing was pulled',
    )
  })

  test('the console stays free of errors and warnings', () => {
    assert.deepEqual(browser.problems, [])
  })
})

describe('reduced motion', () => {
  test('the title card appears at once, without the color wipe', async () => {
    await browser.load({ reduceMotion: true })
    assert.ok(await browser.titlesShown())
    await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(); true`)
    await sleep(150)
    const card = await browser.evaluate<{ opacity: string; wipe: string }>(
      `({ opacity: getComputedStyle(document.querySelector('.ab-sheet')).opacity, wipe: getComputedStyle(document.querySelector('.ab-wipe')).animationName })`,
    )
    assert.deepEqual(card, { opacity: '1', wipe: 'none' })
  })
})

describe('phone (390x844)', () => {
  // Phone emulation widens the layout to fit anything too wide, so overflow is measured
  // against the device's real width, not innerWidth.
  const fits = `innerWidth === 390 && document.documentElement.scrollWidth <= 390`

  before(async () => {
    await browser.load({ width: 390, height: 844, phone: true })
    assert.ok(await browser.titlesShown())
  })

  test('the intro fills the first screen, nothing overflows, and the decade chips wrap', async () => {
    const phone = await browser.evaluate<{
      trendingTop: number
      fits: boolean
      chipRows: number
    }>(`({
      trendingTop: document.querySelector('.ab-page').getBoundingClientRect().top,
      fits: ${fits},
      chipRows: new Set([...document.querySelectorAll('.ab-eras .ab-chip')].map((c) => Math.round(c.getBoundingClientRect().top))).size,
    })`)
    assert.ok(phone.trendingTop >= 843, `trending starts at ${phone.trendingTop}px`)
    assert.ok(phone.fits, 'the page is wider than the phone')
    assert.ok(phone.chipRows >= 2)
  })

  test('every menu item fits on screen without squeezing', async () => {
    const menu = await browser.evaluate<{ right: number; soonHeight: number }>(`({
      right: Math.max(...[...document.querySelectorAll('.ab-nav > *')].map((n) => n.getBoundingClientRect().right)),
      soonHeight: document.querySelector('.ab-nav .ab-soon').getBoundingClientRect().height,
    })`)
    assert.ok(menu.right <= 374, `the menu ends at ${menu.right}px`)
    assert.ok(menu.soonHeight <= 50, `the coming-soon pill is ${menu.soonHeight}px tall`)
  })

  test('search results show in a grid without sideways overflow', async () => {
    await browser.search('one piece')
    assert.ok(await browser.waitFor(`document.querySelector('.ab-results .ab-strip-panel[href]')`))
    assert.ok(await browser.evaluate<boolean>(fits), 'the page is wider than the phone')
    await browser.search('')
  })
})
