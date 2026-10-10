// The Discover page in a real browser: layout, decades, search, the title card, the pull,
// keyboard use, reduced motion and phones. Run with `npm run test:browser` (see browser.ts).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { Browser } from './browser.ts'

let browser: Browser

// The decade strip's row of titles (the row of empty cards shown while loading is another one).
const decadeRow = `document.querySelector('[aria-labelledby="decades"] .ab-strip-row:not([aria-hidden])')`
// The search results' titles, joined; and whether the results heading names a search term.
const resultTitles = `[...document.querySelectorAll('.ab-results .ab-strip-panel[href] .ab-strip-title')].map((t) => t.textContent).join(' | ')`
const resultsFor = (term: string) =>
  `document.querySelector('#results')?.textContent.includes(${JSON.stringify(`“${term}”`)})`

/** Waits until the decade row stops scrolling (snapping animates), so nothing is measured mid-slide. */
async function rowSettled() {
  let last = -1
  for (let settle = 0; settle < 20; settle++) {
    await sleep(100)
    const now = await browser.evaluate<number>(`${decadeRow}.scrollLeft`)
    if (now === last) return
    last = now
  }
}

/**
 * Tabs from the checked decade chip through the strip's panels, then Shift+Tabs back to the
 * first. For each focused panel: how much of it shows inside the row, and whether its focus
 * ring (4px plus a 3px gap) is cut off.
 */
async function tabThroughStrip() {
  await browser.animationsDone() // the panels pop in; measure them once they have landed
  await browser.evaluate(`document.querySelector('.ab-eras input:checked').focus(); true`)
  const seen: { panel: number; back: boolean; visible: number; ringCut: boolean }[] = []
  for (const back of [false, true]) {
    for (let i = 0; i < 20; i++) {
      await browser.press('Tab', back)
      await rowSettled()
      const step = await browser.evaluate<{
        panel: number
        visible: number
        ringCut: boolean
      } | null>(`(() => {
        const panel = document.activeElement
        if (!panel.matches('.ab-strip-row .ab-strip-panel')) return null
        const p = panel.getBoundingClientRect(), row = panel.closest('.ab-strip-row').getBoundingClientRect()
        const visible = Math.max(0, Math.min(p.right, row.right) - Math.max(p.left, row.left)) / p.width
        const ringCut = p.left - 7 < row.left || p.right + 7 > row.right || p.top - 7 < row.top || p.bottom + 7 > row.bottom
        return { panel: [...panel.closest('.ab-strip-row').children].indexOf(panel.parentElement) + 1, visible: Math.round(visible * 100) / 100, ringCut }
      })()`)
      if (step) seen.push({ ...step, back })
    }
  }
  return seen
}

/** Checks a tabThroughStrip() run: every focused panel shows in full, with its whole ring. */
function assertStripInView(steps: Awaited<ReturnType<typeof tabThroughStrip>>) {
  assert.ok(steps.filter((s) => !s.back).length >= 15, 'too few panels reached by Tab')
  assert.ok(steps.filter((s) => s.back).length >= 15, 'too few panels reached by Shift+Tab')
  const label = (s: (typeof steps)[number]) =>
    `${s.back ? 'Shift+Tab' : 'Tab'} to panel ${s.panel}: ${Math.round(s.visible * 100)}% shown${s.ringCut ? ', ring cut' : ''}`
  const bad = steps.filter((s) => s.visible < 0.95 || s.ringCut).map(label)
  assert.deepEqual(bad, [], 'focused panels out of view or with their ring cut off')
}
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

  test('a different search, typed over the last or after clearing it, never shows the old titles while it loads', async () => {
    await browser.search('frieren')
    assert.ok(await browser.waitFor(`/Frieren/i.test(${resultTitles})`), 'no Frieren results')

    // Typed straight over: the box never empties, so the results stay on the page throughout.
    await browser.holdAniList(3_000)
    await browser.search('mushishi')
    assert.ok(await browser.waitFor(resultsFor('mushishi'), 5_000), 'the heading never switched')
    const typedOver = await browser.evaluate<string>(resultTitles)
    await browser.holdAniList(0)
    assert.doesNotMatch(typedOver, /Frieren/i, 'the last search’s titles showed under the new one')
    assert.ok(await browser.waitFor(`/mushi-?shi/i.test(${resultTitles})`), 'no Mushishi results') // English title: MUSHI-SHI

    // Cleared first: a new search starts from nothing, even one that "mushishi" starts with.
    await browser.search('')
    assert.ok(await browser.waitFor(`!document.querySelector('.ab-results')`, 5_000))
    await browser.holdAniList(3_000)
    await browser.search('mushi')
    assert.ok(await browser.waitFor(resultsFor('mushi'), 5_000), 'the heading never switched')
    const afterClear = await browser.evaluate<string>(resultTitles)
    await browser.holdAniList(0)
    assert.equal(afterClear, '', 'the cleared search’s titles came back')
    await browser.search('')
  })

  test('refining a search keeps its titles on screen while the refined one loads', async () => {
    await browser.search('mushishi')
    assert.ok(await browser.waitFor(`/mushi-?shi/i.test(${resultTitles})`), 'no Mushishi results')
    await browser.holdAniList(3_000)
    await browser.search('mushishi zoku')
    assert.ok(
      await browser.waitFor(resultsFor('mushishi zoku'), 5_000),
      'the heading never switched',
    )
    const refining = await browser.evaluate<string>(resultTitles)
    await browser.holdAniList(0)
    assert.match(refining, /mushi-?shi/i, 'the titles emptied while the refined search loaded')
    await browser.search('')
  })

  test('screen readers hear each search’s outcome from one status line that is always there', async () => {
    const region = `document.querySelector('main > [role="status"]')`
    // The previous check clears its search; the line empties once that settles (300 ms).
    assert.ok(
      await browser.waitFor(`${region}?.textContent === ''`, 5_000),
      'no empty announcement line at rest',
    )
    await browser.search('frieren')
    assert.ok(
      await browser.waitFor(`/^\\d+ titles? found for “frieren”$/.test(${region}?.textContent)`),
      'results not announced',
    )
    await browser.search('zzqqxx')
    assert.ok(
      await browser.waitFor(`${region}?.textContent === 'No titles found for “zzqqxx”'`),
      'no-match not announced',
    )
    await browser.search('zzqqxxy')
    assert.ok(
      await browser.waitFor(`${region}?.textContent === 'No titles found for “zzqqxxy”'`),
      'a second no-match read as no change',
    )
    const notes = await browser.evaluate<number>(
      `document.querySelectorAll('.ab-results [role="status"]').length`,
    )
    assert.equal(notes, 0, 'the results’ visible note is a second live region')
    await browser.search('')
    assert.ok(
      await browser.waitFor(`${region}?.textContent === ''`, 5_000),
      'the announcement outlived the search',
    )
  })

  test('a very long search never makes the page scroll sideways', async () => {
    await browser.search(
      'a very long search that keeps going and going past the width of the bubble and the screen '.repeat(
        2,
      ),
    )
    assert.ok(await browser.waitFor(`document.querySelector('.ab-results')`, 5_000))
    await sleep(800)
    const wide = await browser.evaluate<number>('document.documentElement.scrollWidth - innerWidth')
    assert.ok(wide <= 0, `the page is ${wide}px wider than the screen`)
    await browser.search('')
  })

  test('every label on the pull machine reads at 4.5:1 or better', async () => {
    // WCAG contrast of each label's text against the nearest solid background behind it.
    const ratios = await browser.evaluate<{ text: string; ratio: number }[]>(`(() => {
      const rgb = (color) => color.match(/[\\d.]+/g).map(Number)
      const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
      const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
      const behind = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const c = rgb(getComputedStyle(e).backgroundColor)
          if (c.length < 4 || c[3] === 1) return c
        }
        return [255, 255, 255]
      }
      return [...document.querySelectorAll('.ab-body legend, .ab-body .ab-chip span, .ab-body .ab-lever span, .ab-body .ab-count')]
        .map((el) => {
          const [a, b] = [lum(rgb(getComputedStyle(el).color)), lum(behind(el))].sort((x, y) => y - x)
          return { text: el.textContent.trim(), ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100 }
        })
    })()`)
    assert.ok(ratios.length >= 7, `found only ${ratios.length} labels`)
    const faint = ratios.filter((label) => label.ratio < 4.5)
    assert.deepEqual(
      faint,
      [],
      `too faint: ${faint.map((l) => `${l.text} ${l.ratio}:1`).join(', ')}`,
    )
  })

  test('with motion allowed, hovering a panel still zooms its cover', async () => {
    await browser.animationsDone() // each cover settles in from 1.3 times its size
    await browser.evaluate(`document.querySelector('#ab-trending').scrollIntoView(); true`)
    const at = await browser.evaluate<{ x: number; y: number }>(
      `(() => { const r = document.querySelectorAll('.ab-grid .ab-link')[1].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
    )
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await sleep(700) // longer than the zoom's 0.6s transition
    const cover = await browser.evaluate<string>(
      `getComputedStyle(document.querySelectorAll('.ab-grid .ab-link')[1].querySelector('.ab-img img')).transform`,
    )
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
    assert.equal(cover, 'matrix(1.1, 0, 0, 1.1, 0, 0)', 'the hovered cover did not zoom')
  })

  test('tabbing along the decade strip, both ways, keeps each focused panel in view, with its whole ring', async () => {
    assertStripInView(await tabThroughStrip())
  })

  test('the decade panels sit where they did before the row made room for focus rings', async () => {
    // 18px under the decade chips, as before the row gained 8px of room on every side.
    const gap = await browser.evaluate<number>(
      `${decadeRow}.querySelector('.ab-strip-panel').getBoundingClientRect().top - document.querySelector('.ab-eras').getBoundingClientRect().bottom`,
    )
    assert.equal(Math.round(gap), 18)
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

describe('tablet (834x1112, iPad Pro 11" portrait)', () => {
  test('a pulled title stacks under its poster, and nothing overflows once it has landed', async () => {
    await browser.load({ width: 834, height: 1112 })
    assert.ok(await browser.titlesShown())
    await browser.evaluate(
      `document.querySelector('#pull').scrollIntoView(); document.querySelector('.ab-lever').click(); true`,
    )
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-result.is-open .ab-result-copy')`, 5_000),
      'nothing was pulled',
    )
    await browser.animationsDone() // the rarity sticker pops in from 2.4 times its size
    const result = await browser.evaluate<{ columns: string; wide: number }>(`({
      columns: getComputedStyle(document.querySelector('.ab-result')).gridTemplateColumns,
      wide: document.documentElement.scrollWidth - innerWidth,
    })`)
    // Beside the poster, the text got a column about 56px wide (review finding F2).
    assert.equal(result.columns.split(' ').length, 1, `the result has columns ${result.columns}`)
    assert.ok(result.wide <= 0, `the page is ${result.wide}px wider than the screen`)
  })
})

describe('reduced motion', () => {
  before(async () => {
    await browser.load({ reduceMotion: true })
    assert.ok(await browser.titlesShown())
  })

  test('the title card appears at once, without the color wipe', async () => {
    await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(); true`)
    await sleep(150)
    const card = await browser.evaluate<{ opacity: string; wipe: string }>(
      `({ opacity: getComputedStyle(document.querySelector('.ab-sheet')).opacity, wipe: getComputedStyle(document.querySelector('.ab-wipe')).animationName })`,
    )
    assert.deepEqual(card, { opacity: '1', wipe: 'none' })
  })

  test('hovering a panel or holding the lever moves nothing', async () => {
    await browser.evaluate(`document.querySelector('dialog.ab-card')?.close(); true`)
    await sleep(300)
    const centerOf = (selector: string) =>
      browser.evaluate<{ x: number; y: number }>(
        `(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
      )
    const movingTransitions = `document.getAnimations().filter((a) => /transform|width/.test(a.transitionProperty ?? '')).length`
    await browser.evaluate(`document.querySelector('#ab-trending').scrollIntoView(); true`)
    let at = await centerOf('.ab-grid .ab-link')
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await sleep(120)
    const onHover = await browser.evaluate<number>(movingTransitions)
    // A zoom can also apply at once, with no transition to count.
    const cover = await browser.evaluate<string>(
      `getComputedStyle(document.querySelector('.ab-grid .ab-link .ab-img img')).transform`,
    )
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    at = await centerOf('.ab-lever')
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...at,
      button: 'left',
      clickCount: 1,
    })
    await sleep(120)
    const lever = await browser.evaluate<string>(
      `getComputedStyle(document.querySelector('.ab-lever')).transform`,
    )
    const onPress = await browser.evaluate<number>(movingTransitions)
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...at,
      button: 'left',
      clickCount: 1,
    })
    assert.equal(onHover, 0, 'hovering a panel started a moving transition')
    assert.equal(cover, 'none', 'the hovered cover zoomed')
    assert.equal(onPress, 0, 'pressing the lever started a moving transition')
    assert.equal(lever, 'none', 'the held lever turned')
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

  test('on a phone, tabbing along the decade strip, both ways, keeps each focused panel in view, with its whole ring', async () => {
    assertStripInView(await tabThroughStrip())
  })

  test('a long search never pushes the page wider than the phone', async () => {
    await browser.search('The Laid-Off Cheat-Granting Mage Enjoys a Second Lease on Life')
    assert.ok(await browser.waitFor(`document.querySelector('.ab-results')`, 5_000))
    await sleep(800)
    assert.ok(await browser.evaluate<boolean>(fits), 'the page is wider than the phone')
    await browser.search('')
  })

  test('search results show in a grid without sideways overflow', async () => {
    await browser.search('one piece')
    assert.ok(await browser.waitFor(`document.querySelector('.ab-results .ab-strip-panel[href]')`))
    assert.ok(await browser.evaluate<boolean>(fits), 'the page is wider than the phone')
    await browser.search('')
  })
})

describe('small phone (320x568, also a desktop window at 400% zoom)', () => {
  before(async () => {
    await browser.load({ width: 320, height: 568, phone: true })
    assert.ok(await browser.titlesShown())
  })

  test('the decade row rests at its first panel once the panels have popped in', async () => {
    await browser.animationsDone()
    await rowSettled()
    assert.equal(await browser.evaluate(`${decadeRow}.scrollLeft`), 0)
  })

  test('a small sideways scroll of the decade row comes to rest with a panel at its start', async () => {
    await browser.evaluate(`${decadeRow}.scrollIntoView({ block: 'center' }); true`)
    const at = await browser.evaluate<{ x: number; y: number }>(
      `(() => { const r = ${decadeRow}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
    )
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      ...at,
      deltaX: 40,
      deltaY: 0,
    })
    await sleep(300)
    await rowSettled()
    // At rest, some panel starts 8px into the row (the room left for its focus ring).
    const offset = await browser.evaluate<number>(`(() => {
      const row = ${decadeRow}, left = row.getBoundingClientRect().left
      return Math.min(...[...row.querySelectorAll('.ab-strip-panel')].map((p) => Math.abs(p.getBoundingClientRect().left - left - 8)))
    })()`)
    assert.ok(offset <= 1, `the row came to rest ${Math.round(offset)}px off a panel`)
    await browser.evaluate(`${decadeRow}.scrollTo({ left: 0 }); true`)
  })

  test('tabbing along the decade strip, both ways, keeps each focused panel in view, with its whole ring', async () => {
    assertStripInView(await tabThroughStrip())
  })
})
