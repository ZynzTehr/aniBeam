// The Discover page in a real browser: layout, decades, search, the title card, the pull,
// keyboard use, reduced motion and phones. Run with `npm run test:browser` (see browser.ts).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { Browser, type Answer } from './browser.ts'

let browser: Browser

// The decade strip's row of titles (the row of empty cards shown while loading is another one).
const decadeRow = `document.querySelector('[aria-labelledby="decades"] .ab-strip-row:not([aria-hidden])')`
// The search results' titles, joined; and whether the results heading names a search term.
const resultTitles = `[...document.querySelectorAll('.ab-results .ab-strip-panel[href] .ab-strip-title')].map((t) => t.textContent).join(' | ')`
const resultsFor = (term: string) =>
  `document.querySelector('#results')?.textContent.includes(${JSON.stringify(`“${term}”`)})`

/**
 * From now on, lists each results heading the page shows, in order, in window.__headings, so a
 * check sees every search that ran, even one on screen for a moment. Calling it again starts a
 * new list.
 */
async function recordHeadings() {
  await browser.evaluate(`(() => {
    if (!window.__headings)
      new MutationObserver(() => {
        const heading = document.getElementById('results')?.firstChild?.textContent
        if (heading && heading !== window.__headings.at(-1)) window.__headings.push(heading)
      }).observe(document.querySelector('main'), { childList: true, characterData: true, subtree: true })
    window.__headings = []
    return true
  })()`)
}

// An AniList answer of HTTP 400. A bad request isn't retried, so Try again shows at once (a
// failed connection waits out the AniList client's one-minute pause first).
const BAD_REQUEST = {
  status: 400,
  body: { data: null, errors: [{ message: 'Bad request', status: 400 }] },
}
const failSearches = () =>
  browser.rewriteAniList(({ request }) => (request.variables.search ? BAD_REQUEST : null))
const goOffline = (offline: boolean) =>
  browser.send('Network.emulateNetworkConditions', {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

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

// The splash cover's transform. Its parallax moves this span; the img inside zooms on hover.
const splashCover = `getComputedStyle(document.querySelector('.ab-splash .ab-img')).transform`

/**
 * Scrolls the page until that fraction of the splash panel's height has gone off the top of the
 * screen (a negative one leaves its top that far below), then waits two frames, so the
 * scroll-driven parallax has caught up.
 */
async function scrollSplashOut(fraction: number) {
  await browser.evaluate(`(() => {
    const r = document.querySelector('.ab-splash').getBoundingClientRect()
    scrollTo(0, scrollY + r.top + r.height * ${fraction})
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))
  })()`)
}

/**
 * The contrast a part of the page shows on screen: between its dark and its light pixels, taken
 * 5% in from each end, so a few stray pixels don't decide it. Computed styles can't show all
 * that a contrast theme paints, such as the plate Chrome puts behind text. The clip is in CSS
 * pixels from the top left of the page, as for Browser.screenshot.
 */
async function pixelContrast(clip: { x: number; y: number; width: number; height: number }) {
  const png = await browser.screenshot(clip)
  // Decoded in the page.
  return browser.evaluate<number>(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    const lum = []
    for (let i = 0; i < data.length; i += 4) lum.push(0.2126 * channel(data[i]) + 0.7152 * channel(data[i + 1]) + 0.0722 * channel(data[i + 2]))
    lum.sort((a, b) => a - b)
    const dark = lum[Math.floor(lum.length * 0.05)], light = lum[Math.floor(lum.length * 0.95)]
    return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
  })()`)
}

before(async () => {
  browser = await Browser.open()
})
after(() => browser?.close())

describe('desktop (1440x900)', () => {
  // What the page asks AniList for on its first load, a first visit: the profile is new.
  const firstVisit: Answer['request'][] = []
  before(async () => {
    await browser.rewriteAniList(({ request }) => {
      firstVisit.push(request)
      return null
    })
    try {
      await browser.load()
      assert.ok(await browser.titlesShown(), 'trending and decade titles never appeared')
    } finally {
      await browser.rewriteAniList(null)
    }
  })

  // AniList allows 30 requests a minute per IP address, and a class on one Wi-Fi shares one.
  test('a first visit asks AniList for trending and the 1990s in one request', () => {
    // Each request, as the lists it asks for. A decade is named by its first year: its `from`
    // is the YYYYMMDD date just before it.
    const lists = firstVisit.map(({ query, variables }) => [
      ...(query.includes('TRENDING_DESC') ? ['trending'] : []),
      ...(query.includes('POPULARITY_DESC')
        ? [`${Math.ceil(Number(variables.from) / 10000)}s`]
        : []),
    ])
    assert.deepEqual(lists, [['trending', '1990s']], 'the lists each request asked AniList for')
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

  test('the page has one h1: the intro’s title, or the results heading while searching', async () => {
    // Screen readers jump to a page's h1 to learn what the page is about. Search results take
    // the intro's place, so they take its h1 too. The check above searched "frieren", so this
    // one sends no request.
    const h1s = `[...document.querySelectorAll('h1')].map((h) => h.id)`
    await browser.search('')
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-intro')`, 5_000),
      'the intro did not come back',
    )
    const home = await browser.evaluate<string[]>(h1s)
    await browser.search('frieren')
    assert.ok(await browser.waitFor(resultsFor('frieren'), 5_000), 'the heading never showed')
    const searching = await browser.evaluate<string[]>(h1s)
    await browser.search('')
    assert.deepEqual(
      home,
      ['ab-intro-title'],
      'at home, the intro’s title is not the page’s one h1',
    )
    assert.deepEqual(
      searching,
      ['results'],
      'while searching, the results heading is not the page’s one h1',
    )
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

  test('refining a search keeps its titles on screen, and the visitor’s place, while it loads', async () => {
    await browser.search('mushishi')
    assert.ok(await browser.waitFor(`/mushi-?shi/i.test(${resultTitles})`), 'no Mushishi results')
    await browser.evaluate('scrollTo(0, 300); true')
    await browser.holdAniList(3_000)
    await browser.search('mushishi zoku')
    assert.ok(
      await browser.waitFor(resultsFor('mushishi zoku'), 5_000),
      'the heading never switched',
    )
    const refining = await browser.evaluate<{ titles: string; scrollY: number }>(
      `({ titles: ${resultTitles}, scrollY })`,
    )
    await browser.holdAniList(0)
    assert.match(
      refining.titles,
      /mushi-?shi/i,
      'the titles emptied while the refined search loaded',
    )
    assert.equal(refining.scrollY, 300, 'refining the search moved the page')
    await browser.search('')
  })

  test('a refinement typed from below the results brings them back into view', async () => {
    // Both searches were made by the check above, so this one sends no request.
    // Where the results heading is, and the part of the view below the header.
    const heading = () =>
      browser.evaluate<{ top: number; below: number; bottom: number }>(`({
        top: document.getElementById('results').getBoundingClientRect().top,
        below: document.querySelector('.ab-top').getBoundingClientRect().bottom,
        bottom: innerHeight,
      })`)
    // Wait for this search's own heading: the check above has just cleared “mushishi zoku”,
    // whose results show until the box has been still for 300 ms.
    await browser.search('mushishi')
    assert.ok(
      await browser.waitFor(`${resultsFor('mushishi')} && /mushi-?shi/i.test(${resultTitles})`),
      'no Mushishi results',
    )
    // Where the header's Trending link lands, the results end behind the header.
    await browser.evaluate(`document.getElementById('ab-trending').scrollIntoView(); true`)
    const end = await browser.evaluate<number>(
      `document.querySelector('.ab-results').getBoundingClientRect().bottom`,
    )
    await browser.search('mushishi zoku') // letters added
    assert.ok(
      await browser.waitFor(resultsFor('mushishi zoku'), 5_000),
      'the heading never switched',
    )
    const added = await heading()
    // Far below the results, at the pull.
    await browser.evaluate(`document.getElementById('pull').scrollIntoView(); true`)
    await browser.search('mushishi') // letters removed
    assert.ok(await browser.waitFor(resultsFor('mushishi'), 5_000), 'the heading never switched')
    const removed = await heading()
    await browser.search('')
    assert.ok(
      end > 0 && end <= added.below,
      `where the Trending link lands, the results end at ${Math.round(end)}px, not behind the header (0 to ${Math.round(added.below)}px)`,
    )
    const outOfView = [
      { typed: '“mushishi zoku” typed where the Trending link lands', ...added },
      { typed: '“mushishi” typed at the pull', ...removed },
    ]
      .filter((at) => at.top < at.below || at.top >= at.bottom)
      .map(
        (at) =>
          `${at.typed}: heading at ${Math.round(at.top)}px, view ${Math.round(at.below)}px to ${at.bottom}px`,
      )
    assert.deepEqual(
      outOfView,
      [],
      'a refinement typed from below the results left them out of view',
    )
  })

  test('a typed space restarts the search’s pause, so two words typed at an easy pace search once', async () => {
    // Both searches were made by the check above, so this one sends no request.
    await browser.search('')
    assert.ok(await browser.waitFor(`!document.querySelector('.ab-results')`, 5_000))
    await recordHeadings()
    await browser.evaluate(`document.querySelector('.ab-search input').focus(); true`)
    // "mushishi", 200 ms, a space, 200 ms, "zoku": each pause is shorter than the 300 ms one
    // that starts a search, so nothing should be searched until "zoku" is in. A pause counts
    // from when the last key was sent: a key takes 10 to 80 ms to come back, which would
    // stretch the pauses toward 300 ms.
    let sent = 0
    const type = async (text: string) => {
      for (const character of text) {
        sent = performance.now()
        await browser.send('Input.insertText', { text: character })
      }
    }
    const pause = (ms: number) => sleep(Math.max(0, sent + ms - performance.now()))
    await type('mushishi')
    await pause(200)
    await type(' ')
    await pause(200)
    await type('zoku')
    assert.ok(await browser.waitFor(resultsFor('mushishi zoku'), 5_000), 'the heading never showed')
    const headings = await browser.evaluate<string[]>('window.__headings')
    await browser.search('')
    assert.deepEqual(
      headings,
      ['Results for “mushishi zoku”'],
      'a search ran while the visitor was still typing',
    )
  })

  test('with an input method, Japanese is searched once each word is converted, and Latin letters as they are typed', async () => {
    // A Japanese input method shows a word as kana, then as candidate words, until the visitor
    // picks one. Searching any of those would be searching for a word nobody typed. The checks
    // above searched "frieren", so only 進撃の巨人 costs a request.
    const box = `document.querySelector('.ab-search input')`
    // Each step is sent 100 ms after the one before: well within the 300 ms pause that starts a
    // search, while a run of steps lasts longer than that pause.
    let sent = 0
    const step = async (method: string, params: object) => {
      await sleep(Math.max(0, sent + 100 - performance.now()))
      sent = performance.now()
      await browser.send(method, params)
    }
    const compose = async (...texts: string[]) => {
      for (const text of texts)
        await step('Input.imeSetComposition', {
          text,
          selectionStart: text.length,
          selectionEnd: text.length,
        })
    }
    const commit = (text: string) => step('Input.insertText', { text })

    // しんげき with a pause, a wrong candidate with a pause, then 進撃 picked and の巨人 typed
    // straight after it: one search, for the whole title.
    await browser.search('')
    assert.ok(await browser.waitFor(`!document.querySelector('.ab-results')`, 5_000))
    await recordHeadings()
    await browser.evaluate(`${box}.focus(); true`)
    await compose('s', 'sh', 'し', 'しn', 'しん', 'しんg', 'しんげ', 'しんげk', 'しんげき')
    const kana = await browser.evaluate<string>(`${box}.value`)
    await sleep(700)
    await compose('神撃')
    await sleep(700)
    await compose('進撃')
    await commit('進撃')
    await compose('n', 'の', 'のk', 'のky', 'のきょ')
    await compose('のきょj', 'のきょじ', 'のきょじn', 'のきょじん', 'の巨人')
    await commit('の巨人')
    const converted = await browser.waitFor(resultsFor('進撃の巨人'), 5_000)
    const headings = await browser.evaluate<string[]>('window.__headings')

    // A word being converted after a search keeps that search's results on screen.
    await browser.search('frieren')
    assert.ok(await browser.waitFor(`/Frieren/i.test(${resultTitles})`), 'no Frieren results')
    await commit(' ')
    await compose('し', 'しn', 'しん')
    await sleep(700)
    const added = await browser.evaluate<{ heading?: string; frieren: boolean }>(
      `({ heading: document.getElementById('results')?.firstChild?.textContent, frieren: /Frieren/i.test(${resultTitles}) })`,
    )
    await compose('') // cancels the word

    // Android keyboards compose Latin words too: those are searched while still composing.
    await browser.search('')
    assert.ok(await browser.waitFor(`!document.querySelector('.ab-results')`, 5_000))
    await compose('f', 'fr', 'fri', 'frie', 'frier', 'friere', 'frieren')
    const composing = await browser.waitFor(resultsFor('frieren'), 5_000)
    await compose('')
    await browser.search('')

    assert.equal(kana, 'しんげき', 'the box did not show the kana being converted')
    assert.ok(converted, 'the converted title was never searched')
    assert.deepEqual(
      headings,
      ['Results for “進撃の巨人”'],
      'a search ran while a word was still being converted',
    )
    assert.deepEqual(
      added,
      { heading: 'Results for “frieren”', frieren: true },
      'a word being converted replaced the search before it',
    )
    assert.ok(composing, 'Latin letters still being composed were not searched')
  })

  test('a different search shows that it is loading, even when typed from far down the results', async () => {
    const panels = `document.querySelectorAll('.ab-results .ab-strip-panel[href]')`
    await browser.search('naruto')
    assert.ok(await browser.waitFor(`${panels}.length >= 12`), 'too few Naruto results')
    // The header stays on screen here, so the box can be typed in from anywhere on the page.
    await browser.evaluate(`[...${panels}].at(-1).scrollIntoView({ block: 'center' }); true`)
    await browser.holdAniList(3_000)
    await browser.search('dragon ball')
    assert.ok(await browser.waitFor(resultsFor('dragon ball'), 5_000), 'the heading never switched')
    await sleep(100)
    const loading = await browser.evaluate<{ text: string; top: number; below: number }>(`(() => {
      const note = document.querySelector('.ab-results .ab-note'), r = note.getBoundingClientRect()
      return { text: note.textContent, top: r.top, below: document.querySelector('.ab-top').getBoundingClientRect().bottom }
    })()`)
    await browser.holdAniList(0)
    assert.equal(loading.text, 'Loading…')
    assert.ok(
      loading.top >= loading.below && loading.top < 900,
      `the Loading… line is at ${Math.round(loading.top)}px, outside the view under the header (${Math.round(loading.below)}px to 900px)`,
    )
    await browser.search('')
  })

  test('titles that have left the screen stay gone, even for a search they would refine', async () => {
    await browser.search('naruto')
    assert.ok(await browser.waitFor(`/naruto/i.test(${resultTitles})`), 'no Naruto results')
    await browser.holdAniList(3_000)
    await browser.search('dragon')
    assert.ok(await browser.waitFor(resultsFor('dragon'), 5_000), 'the heading never switched')
    await browser.search('nar') // "naruto" refines "nar", but its titles are no longer on screen
    assert.ok(await browser.waitFor(resultsFor('nar'), 5_000), 'the heading never switched')
    const titles = await browser.evaluate<string>(resultTitles)
    await browser.holdAniList(0)
    assert.equal(titles, '', 'the Naruto titles came back under “nar”')
    await browser.search('')
  })

  test('Try again hands focus to the heading only when it goes while focused, never while it stays', async () => {
    // A returning visitor whose saved trending titles are over 30 minutes old: the page
    // refreshes them, and AniList turns the refresh down. The saved titles stay on screen.
    await sleep(1_500) // the saved copy updates a second after the page's last change
    await browser.evaluate(`(() => {
      const saved = JSON.parse(localStorage.getItem('anibeam:cache'))
      for (const query of saved.clientState.queries) query.state.dataUpdatedAt -= 60 * 60 * 1000
      localStorage.setItem('anibeam:cache', JSON.stringify(saved))
      return true
    })()`)
    await browser.rewriteAniList(() => BAD_REQUEST)
    await browser.load()
    const retry = `document.querySelector('.ab-page .ab-retry')`
    const note = `document.querySelector('.ab-page .ab-note').textContent`
    assert.ok(await browser.waitFor(retry), 'no Try again over the saved titles')
    await goOffline(true)
    await browser.evaluate(`${retry}.focus(); true`)
    await browser.press('Enter') // TanStack holds the refresh until the connection is back
    await sleep(300)
    const offline = await browser.evaluate<{ focus: string; note: string }>(
      `({ focus: document.activeElement.className, note: ${note} })`,
    )
    await goOffline(false) // the held refresh runs, and the button hides while it does
    const moved = await browser.waitFor(`document.activeElement.id === 'ab-trending'`, 5_000)
    // AniList turns it down again, and the button comes back. This time it goes while the
    // visitor is in the search box, which keeps focus.
    assert.ok(await browser.waitFor(retry), 'Try again did not come back')
    await goOffline(true)
    await browser.evaluate(
      `document.querySelector('.ab-search input').focus(); ${retry}.click(); true`,
    )
    await goOffline(false)
    // The held refresh runs (the button goes) and is turned down (it comes back).
    assert.ok(
      await browser.waitFor(`${retry} && !${note}.startsWith('Offline')`),
      'Try again did not come back again',
    )
    const elsewhere = await browser.evaluate<string>(`document.activeElement.tagName`)
    // Refresh the titles for real, so the checks after this one start from a quiet page.
    await browser.rewriteAniList(null)
    await browser.evaluate(`${retry}.click(); true`)
    await browser.waitFor(`!${retry} && ${note} === ''`)
    assert.deepEqual(offline, {
      focus: 'ab-btn ab-retry',
      note: 'Offline: waiting for a connection.',
    })
    assert.ok(moved, 'focus fell off the button as it went')
    assert.equal(elsewhere, 'INPUT', 'the button took focus from the search box as it went')
  })

  test('a mouse press on Try again leaves the page where it is', async () => {
    await failSearches()
    await browser.search('bad request')
    assert.ok(await browser.waitFor(`document.querySelector('.ab-results .ab-retry')`), 'no button')
    // The button just under the header, with its section's heading hidden behind the header.
    const at = await browser.evaluate<{ x: number; y: number }>(`(() => {
      const button = document.querySelector('.ab-results .ab-retry')
      scrollBy(0, button.getBoundingClientRect().top - document.querySelector('.ab-top').getBoundingClientRect().bottom - 12)
      const r = button.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    const before = await browser.evaluate<number>('scrollY')
    const click = { ...at, button: 'left', clickCount: 1 }
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...click })
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...click })
    await sleep(500)
    const after = await browser.evaluate<number>('scrollY')
    await browser.rewriteAniList(null)
    await browser.search('')
    assert.ok(before > 0, 'the page did not scroll down to the button')
    assert.equal(after, before, 'pressing Try again scrolled the page')
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

  test('from 900px up, a long search fills only the room beside the links, so the header stays one row', async () => {
    // From 900px the logo, the links and the search share one row of the sticky header, and a
    // long query's bubble fills the room the links leave. It used to drop onto a second row, so
    // on windows up to about 1300px wide the header grew from 78 to 134px and hid the headings
    // its links jump to. The check above searched this query, so this one sends no request.
    const long =
      'a very long search that keeps going and going past the width of the bubble and the screen '.repeat(
        2,
      )
    const resize = (width: number) =>
      browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
    // The header's height and content edges, the room its links leave, the top of the links,
    // and the bubble's box, once the bubble has taken its text's measured width (a frame late)
    // and eased there.
    const measure = async () => {
      await browser.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
      )
      await browser.animationsDone()
      return browser.evaluate<{
        height: number
        left: number
        right: number
        room: number
        linksTop: number
        bubble: { top: number; right: number; width: number }
      }>(`(() => {
        const top = document.querySelector('.ab-top'), box = top.getBoundingClientRect(), style = getComputedStyle(top)
        const links = document.querySelector('.ab-nav').getBoundingClientRect()
        const bubble = document.querySelector('.ab-bubble-field').getBoundingClientRect()
        const right = box.right - parseFloat(style.paddingRight)
        return {
          height: box.height,
          left: box.left + parseFloat(style.paddingLeft),
          right,
          room: right - links.right - parseFloat(style.columnGap),
          linksTop: links.top,
          bubble: { top: bubble.top, right: bubble.right, width: bubble.width },
        }
      })()`)
    }
    const rest = Math.round((await measure()).height)
    await browser.search(long)
    assert.ok(await browser.waitFor(resultsFor(long.trim())), 'the long search showed no results')
    const problems: string[] = []
    for (const width of [900, 1024, 1180, 1280]) {
      await resize(width)
      const held = await measure()
      const below = Math.round(held.bubble.top - held.linksTop)
      if (Math.abs(held.height - rest) > 1)
        problems.push(`${width}px: the header is ${Math.round(held.height)}px tall, not ${rest}px`)
      if (Math.abs(below) >= 30)
        problems.push(`${width}px: the bubble sits ${below}px below the links`)
      if (Math.abs(held.bubble.width - held.room) > 2)
        problems.push(
          `${width}px: the bubble is ${Math.round(held.bubble.width)}px wide, not the ${Math.round(held.room)}px the links leave`,
        )
    }
    // Below 900px the header stacks, and the bubble fills a row of its own.
    await resize(834)
    const stacked = await measure()
    const row = stacked.right - stacked.left
    if (Math.abs(stacked.bubble.width - row) > 2)
      problems.push(
        `834px: the bubble is ${Math.round(stacked.bubble.width)}px wide, not the row’s ${Math.round(row)}px`,
      )
    // Empty and at rest, it still sits at the header's right end.
    await resize(1024)
    await browser.search('')
    await browser.evaluate('document.activeElement.blur(); true')
    const resting = await measure()
    const short = Math.round(resting.right - resting.bubble.right)
    if (Math.abs(short) > 1)
      problems.push(`1024px, at rest: the bubble ends ${short}px short of the header’s right edge`)
    // Back to this describe's screen before anything is asserted, so the checks after this one
    // see the screen they expect.
    await resize(1440)
    assert.deepEqual(problems, [], 'a long search wraps the header, or the bubble leaves its place')
  })

  test('every label on the pull machine reads at 4.5:1 or better', async () => {
    // WCAG contrast of every piece of text on the machine, so a label added later is measured
    // too. Each is measured against the first solid background behind it, plain and under each
    // color of its pattern (the screentone dots darken the body's pink), with a see-through
    // text color blended in as the screen shows it. Text in a box 1px or smaller is for screen
    // readers only. Every label must reach 4.5:1, even the lever's large one (WCAG asks 3:1).
    const ratios = await browser.evaluate<{ text: string; ratio: number }[]>(`(() => {
      // Chrome gives colors written in hex, by name, or with rgb() or hsl() as rgb() or rgba().
      // Others, such as the oklch() of Tailwind's palette, would be misread: they stop the check.
      const rgba = (color) => {
        if (!/^rgba?\\(/.test(color)) throw new Error('cannot measure the color ' + color)
        const [r, g, b, a = 1] = color.match(/[\\d.]+/g).map(Number)
        return [r, g, b, a]
      }
      // A color with alpha a, laid over a solid one.
      const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)]
      const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
      const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
      const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05) }
      const fills = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const style = getComputedStyle(e), fill = rgba(style.backgroundColor)
          if (fill[3] < 1) continue
          const pattern = style.backgroundImage.match(/(?:rgba?|lab|lch|oklab|oklch|color)\\([^)]*\\)/g) ?? []
          return [fill, ...pattern.map((color) => over(rgba(color), fill))]
        }
        return [[255, 255, 255]]
      }
      const labels = [], walker = document.createTreeWalker(document.querySelector('.ab-machine'), NodeFilter.SHOW_TEXT)
      for (let node; (node = walker.nextNode()); ) {
        const el = node.parentElement, box = el.getBoundingClientRect()
        if (!node.textContent.trim() || box.width <= 1 || box.height <= 1) continue
        const color = rgba(getComputedStyle(el).color)
        const worst = Math.min(...fills(el).map((fill) => ratio(over(color, fill), fill)))
        labels.push({ text: node.textContent.trim(), ratio: Math.round(worst * 100) / 100 })
      }
      return labels
    })()`)
    assert.ok(ratios.length >= 8, `found only ${ratios.length} labels`)
    const faint = ratios.filter((label) => label.ratio < 4.5)
    assert.deepEqual(
      faint,
      [],
      `too faint: ${faint.map((l) => `${l.text} ${l.ratio}:1`).join(', ')}`,
    )
  })

  test('the vibe pill is centered on its text and clear of the chips’ focus rings', async () => {
    const pill = await browser.evaluate<{ left: number; right: number; ringGap: number }>(`(() => {
      const legend = document.querySelector('.ab-moods legend'), box = legend.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(legend)
      const text = range.getBoundingClientRect()
      // Chrome adds letter spacing after the last letter too, where it shows as space.
      const trailing = parseFloat(getComputedStyle(legend).letterSpacing)
      // A checked chip lifts 2px, and a focused one's ring reaches 7px further (4px, 3px out).
      const ringTops = [...document.querySelectorAll('.ab-moods .ab-chip span')]
        .map((chip) => ({ r: chip.getBoundingClientRect(), lifted: chip.previousElementSibling.checked }))
        .filter(({ r }) => r.left - 7 < box.right && r.right + 7 > box.left)
        .map(({ r, lifted }) => r.top - (lifted ? 0 : 2) - 7)
      return { left: text.left - box.left, right: box.right - (text.right - trailing), ringGap: Math.min(...ringTops) - box.bottom }
    })()`)
    assert.ok(
      Math.abs(pill.left - pill.right) <= 0.5,
      `the text sits ${(pill.right - pill.left).toFixed(1)}px left of center`,
    )
    assert.ok(pill.ringGap >= 2, `a focused chip's ring comes within ${pill.ringGap}px of the pill`)
  })

  test('with motion allowed, hovering a panel eases its cover into a zoom and its caption up', async () => {
    await browser.animationsDone() // each cover settles in from 1.3 times its size
    await browser.evaluate(`document.querySelector('#ab-trending').scrollIntoView(); true`)
    const panel = `document.querySelectorAll('.ab-grid .ab-link')[1]`
    const cover = `getComputedStyle(${panel}.querySelector('.ab-img img')).transform`
    // Notes the cover and the caption as a transform transition starts on each. While their
    // finished entrances still held the transform, the zoom and the lift jumped there at once.
    await browser.evaluate(`(() => {
      window.__eased = new Set()
      for (const el of [${panel}.querySelector('.ab-img img'), ${panel}.querySelector('.ab-caption')])
        el.addEventListener('transitionrun', (event) => {
          if (event.target === el && event.propertyName === 'transform') window.__eased.add(el.className || el.tagName)
        })
      return true
    })()`)
    const at = await browser.evaluate<{ x: number; y: number }>(
      `(() => { const r = ${panel}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
    )
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await browser.waitFor(`${cover} === 'matrix(1.1, 0, 0, 1.1, 0, 0)'`, 3_000) // the zoom takes 0.6s
    const zoom = await browser.evaluate<string>(cover)
    const eased = await browser.evaluate<string[]>(`[...window.__eased].sort()`)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
    assert.equal(zoom, 'matrix(1.1, 0, 0, 1.1, 0, 0)', 'the hovered cover did not zoom')
    assert.deepEqual(
      eased,
      ['IMG', 'ab-caption'],
      'the zoom or the caption lift jumped instead of easing',
    )
  })

  test('with motion allowed, the splash cover drifts only as the page scrolls it away', async () => {
    // The splash cover grows and slides down as its panel leaves the top of the screen. The
    // drift runs on a view() timeline, which follows the nearest scroll container: while the
    // panel links had overflow: hidden, that was the splash's own link, which never scrolls, so
    // the cover never moved.
    const matrix = `new DOMMatrix(${splashCover})`
    await scrollSplashOut(-0.05) // its top just below the top of the screen, about to leave
    const still = await browser.waitFor(`${matrix}.isIdentity`, 2_000)
    const inView = await browser.evaluate<string>(splashCover)
    await scrollSplashOut(0.5) // halfway out, it has grown about 6% and slid about 40px down
    const drifting = await browser.waitFor(`${matrix}.a > 1.03 && ${matrix}.f > 10`, 2_000)
    const halfOut = await browser.evaluate<string>(splashCover)
    await browser.evaluate('scrollTo(0, 0); true')
    assert.ok(still, `the splash cover moved before its panel began to leave the screen: ${inView}`)
    assert.ok(drifting, `the splash cover stayed put with half its panel scrolled away: ${halfOut}`)
  })

  test('every trending panel shows a brand-hot focus ring when tabbed to', async () => {
    // A panel's ring is its link's outline: 4px of brand hot, 3px out. Panels 4 and 5 share the
    // diagonal cut, whose clip-paths cut that ring away, so tabbing to them showed nothing; their
    // 4px ink frame turns brand hot instead. getComputedStyle still reports the cut-away outline,
    // so this counts brand-hot pixels in a screenshot of each panel, within 4px of its box, inside
    // or out: at least 4,400 for a whole ring or frame here, and 0 for none. The boxes of panels 4
    // and 5 overlap along the cut, where the other panel's cover shows (or its color, brand hot
    // itself for a title without one), so pixels inside another panel's box don't count.
    await browser.animationsDone() // each panel's ink wipe covers its frame until it has gone
    const panels = `document.querySelectorAll('.ab-grid .ab-link')`
    const seen: { reached: number; focusVisible: boolean; hot: number }[] = []
    for (let k = 0; k < 9; k++) {
      // Tab from the stop before the panel: the trending heading, or the panel before it.
      const before = k ? `${panels}[${k - 1}]` : `document.getElementById('ab-trending')`
      await browser.evaluate(`${before}.focus({ preventScroll: true }); true`)
      await browser.press('Tab')
      // Centers the panel and waits two frames, so it is painted there. The clip is its box with
      // 8px to spare, in whole pixels from the top left of the page.
      const { reached, focusVisible, clip } = await browser.evaluate<{
        reached: number
        focusVisible: boolean
        clip: { x: number; y: number; width: number; height: number }
      }>(`(async () => {
        const link = ${panels}[${k}]
        link.parentElement.scrollIntoView({ block: 'center' })
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const r = link.parentElement.getBoundingClientRect()
        const x = Math.floor(r.left + scrollX) - 8, y = Math.floor(r.top + scrollY) - 8
        const width = Math.ceil(r.right + scrollX) + 8 - x, height = Math.ceil(r.bottom + scrollY) + 8 - y
        return {
          reached: [...${panels}].indexOf(document.activeElement) + 1,
          focusVisible: link.matches(':focus-visible'),
          clip: { x, y, width, height },
        }
      })()`)
      const png = await browser.screenshot(clip)
      // Decoded in the page. A pixel within 60 of #ff2d55 counts as brand hot.
      const hot = await browser.evaluate<number>(`(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const { data } = context.getImageData(0, 0, image.width, image.height)
        // Boxes in the screenshot's pixels.
        const box = (el) => {
          const r = el.getBoundingClientRect(), x = scrollX - ${clip.x}, y = scrollY - ${clip.y}
          return { left: r.left + x, top: r.top + y, right: r.right + x, bottom: r.bottom + y }
        }
        const li = ${panels}[${k}].parentElement, own = box(li)
        const others = [...li.parentElement.children].filter((el) => el !== li).map(box)
        const within = (b, x, y, grow) => x >= b.left - grow && x < b.right + grow && y >= b.top - grow && y < b.bottom + grow
        // Within 4px of the panel's box, inside or out, and in no other panel's box.
        const atEdge = (x, y) => within(own, x, y, 4) && !within(own, x, y, -4) && !others.some((b) => within(b, x, y, 0))
        let hot = 0
        for (let y = 0; y < image.height; y++)
          for (let x = 0; x < image.width; x++) {
            const i = (y * image.width + x) * 4
            if (atEdge(x + 0.5, y + 0.5) && Math.hypot(data[i] - 255, data[i + 1] - 45, data[i + 2] - 85) < 60) hot++
          }
        return hot
      })()`)
      seen.push({ reached, focusVisible, hot })
    }
    await browser.evaluate('document.activeElement.blur(); scrollTo(0, 0); true')
    assert.deepEqual(
      seen.map((s) => s.reached),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      'Tab did not go from panel to panel in order',
    )
    assert.deepEqual(
      seen
        .filter((s) => !s.focusVisible || s.hot < 1000)
        .map(
          (s) =>
            `panel ${s.reached}: ${s.hot} brand-hot pixels${s.focusVisible ? '' : ', not :focus-visible'}`,
        ),
      [],
      'panels that show no brand-hot focus ring when tabbed to',
    )
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

  test('with motion allowed, a newly picked decade stays at Ch.1 while its titles pop in', async () => {
    // Each title pops in, small and tilted at first. The row snaps to its list items, and Chrome
    // snaps to an item's box as transformed, so when the items themselves popped in, the row slid
    // about 32px sideways and back as the first one grew. The slide was over in about 170ms, so
    // the row is read on every frame.
    const checked = `document.querySelector('.ab-eras input:checked').value`
    const first = `${decadeRow}?.querySelector('.ab-strip-title')?.textContent`
    // From the 1980s, scrolled to their end. A load opens on the 1990s, so the 1980s an earlier
    // check picked may be gone by now (or this check may run alone): pick them if so.
    if ((await browser.evaluate<string>(checked)) !== '1980s') {
      const nineties = await browser.evaluate<string>(first)
      await browser.evaluate(
        `document.querySelector('.ab-eras input[value="1980s"]').click(); true`,
      )
      assert.ok(
        await browser.waitFor(`${first} && ${first} !== ${JSON.stringify(nineties)}`),
        'the strip kept the 1990s titles',
      )
    }
    await browser.animationsDone()
    await browser.evaluate(
      `${decadeRow}.scrollIntoView({ block: 'center' }); ${decadeRow}.scrollTo({ left: ${decadeRow}.scrollWidth, behavior: 'instant' }); true`,
    )
    await rowSettled()
    const scrolled = await browser.evaluate<number>(`${decadeRow}.scrollLeft`)
    // Back to the 1990s, which come from the cache: the row's scrollLeft on every frame that
    // shows their titles, until 2 seconds after they went in, when the last has popped in.
    type Frame = { ms: number; left: number }
    const frames = await browser.evaluate<Frame[]>(`new Promise((resolve) => {
      const before = ${first}, frames = []
      let shown = null, done = false
      const finish = () => { done = true; resolve(frames) }
      const sample = (now) => {
        if (done) return
        const title = ${first}
        if (title && title !== before) {
          shown ??= now
          frames.push({ ms: Math.round(now - shown), left: ${decadeRow}.scrollLeft })
        }
        if (shown !== null && now - shown > 2000) finish()
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      setTimeout(finish, 10000)
      document.querySelector('.ab-eras input[value="1990s"]').click()
    })`)
    assert.ok(scrolled > 0, 'the 1980s row did not scroll')
    assert.ok(frames.length > 0, 'the 1990s titles never replaced the 1980s')
    assert.deepEqual(
      frames.filter((frame) => frame.left !== 0).map((frame) => `${frame.left}px at ${frame.ms}ms`),
      [],
      'the row slid off Ch.1 while the 1990s popped in (its scrollLeft, by time since their titles went in)',
    )
  })

  test('screen readers hear each pull in one sentence, and the machine says nothing on its own', async () => {
    // A live region speaks every change to its text. The whole reveal used to be one: it spoke
    // its hint when titles arrived, and each pull read the title twice, every star ("black
    // star") and the button's label. Now one status line, there from the start, says each pull.
    const line = `document.querySelector('#pull > [role="status"]')`
    const live = `[...document.querySelectorAll('#pull [aria-live], #pull [role="status"], #pull [role="alert"]')].map((el) => el.className)`
    assert.deepEqual(
      await browser.evaluate(`({ line: ${line}?.textContent ?? null, live: ${live} })`),
      { line: '', live: ['sr-only'] },
      'before any pull, the only live region in the pull section should be its empty status line',
    )
    // What the line says, and the sentence for the capsule once it has opened: the pull's
    // number from the counter, the title and its tier.
    const heard = `(() => {
      const result = document.querySelector('.ab-result.is-open:not([data-old])')
      const count = parseInt(document.querySelector('.ab-count').textContent)
      const tier = result?.querySelector('.ab-tier').textContent.split(' ')[0]
      const shown = result && 'Pull ' + count + ': ' + result.querySelector('h3').textContent + ', ' + tier + '.'
      return { line: ${line}?.textContent ?? null, count, shown }
    })()`
    // Text with a star in it that a screen reader would read out.
    const starsRead = `(() => {
      const found = [], walker = document.createTreeWalker(document.querySelector('#pull'), NodeFilter.SHOW_TEXT)
      for (let node; (node = walker.nextNode()); )
        if (node.textContent.includes('★') && !node.parentElement.closest('[aria-hidden="true"]')) found.push(node.parentElement.className)
      return found
    })()`
    await browser.evaluate(
      `document.querySelector('#pull').scrollIntoView(); document.querySelector('.ab-lever').focus(); true`,
    )
    const counts: number[] = []
    for (let i = 0; i < 2; i++) {
      await browser.evaluate(
        `document.querySelector('.ab-result')?.setAttribute('data-old', ''); true`,
      )
      await browser.press('Enter')
      // Silent until the capsule opens 0.9s later, so the pull is heard as it is seen.
      const pressed = await browser.evaluate<{ line: string; shown: string | null }>(heard)
      assert.ok(
        pressed.shown || pressed.line === '',
        `"${pressed.line}" was heard before the capsule opened`,
      )
      await browser.waitFor(`(({ line, shown }) => shown && line === shown)(${heard})`, 5_000)
      const opened = await browser.evaluate<{ line: string; count: number; shown: string | null }>(
        heard,
      )
      assert.ok(opened.shown, 'the capsule never opened')
      assert.equal(opened.line, opened.shown, 'the line does not say the pull on screen')
      assert.match(opened.line, /^Pull \d+: .+, (SSR|SR|R|Mystery)\.$/)
      assert.deepEqual(await browser.evaluate(starsRead), [], 'stars a screen reader would read')
      counts.push(opened.count)
    }
    assert.equal(counts[1], counts[0] + 1, 'the second pull’s number did not go up by one')
    // The result itself must not speak either, or it reads the title a second time.
    assert.deepEqual(
      await browser.evaluate(live),
      ['sr-only'],
      'live regions in the pull section once a title is out',
    )
  })

  test('the lever pulls a real title from the page', async () => {
    await pull()
    assert.ok(
      await browser.evaluate(
        `document.querySelector('.ab-result:not([data-old]) h3')?.textContent`,
      ),
      'the capsule holds no title',
    )
  })

  test('with motion allowed, hovering the lever still tilts it', async () => {
    // The other half of pull.e2e.ts's check that the off lever stays still: a working one still
    // tilts. It only hovers, so it pulls nothing.
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    const at = await browser.evaluate<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('.ab-lever').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
    )
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await sleep(400) // longer than the lever's 0.25s turn
    const lever = await browser.evaluate<string>(
      `getComputedStyle(document.querySelector('.ab-lever')).transform`,
    )
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
    assert.equal(
      lever,
      'matrix(0.984808, -0.173648, 0.173648, 0.984808, 0, 0)', // rotate(-10deg)
      'the hovered lever did not tilt',
    )
  })

  test('the console stays free of errors and warnings', () => {
    assert.deepEqual(browser.problems, [])
  })
})

/** Pulls the lever and waits for the new result to open. Each pull renders a fresh result. */
async function pull() {
  await browser.evaluate(
    `document.querySelector('.ab-result')?.setAttribute('data-old', ''); document.querySelector('#pull').scrollIntoView(); document.querySelector('.ab-lever').click(); true`,
  )
  assert.ok(
    await browser.waitFor(
      `document.querySelector('.ab-result.is-open:not([data-old]) .ab-sfx-tier')`,
    ),
    'nothing was pulled',
  )
}

describe('tablet (834x1112, iPad Pro 11" portrait) and up', () => {
  before(async () => {
    await browser.load({ width: 834, height: 1112 })
    assert.ok(await browser.titlesShown())
  })

  test('a pulled title stacks under its poster, and nothing overflows once it has landed', async () => {
    await pull()
    await browser.animationsDone() // the rarity sticker pops in from 2.4 times its size
    const result = await browser.evaluate<{ columns: string; wide: number }>(`({
      columns: getComputedStyle(document.querySelector('.ab-result')).gridTemplateColumns,
      wide: document.documentElement.scrollWidth - innerWidth,
    })`)
    // Beside the poster, the text got a column about 56px wide (review finding F2).
    assert.equal(result.columns.split(' ').length, 1, `the result has columns ${result.columns}`)
    assert.ok(result.wide <= 0, `the page is ${result.wide}px wider than the screen`)
  })

  test('a pulled title’s long words never break mid-word, from tablet to desktop', async () => {
    await pull()
    await browser.animationsDone()
    // Long words from real titles (isekai titles are full of "Reincarnated").
    const words =
      'Bakemonogatari Assassination Entertainment Reincarnation Reincarnated Experiments Edgerunners Brotherhood Apothecary Cardcaptor'
    const broken: string[] = []
    for (const width of [834, 1001, 1024, 1060, 1100, 1170, 1180, 1280, 1440]) {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1112,
        deviceScaleFactor: 1,
        mobile: false,
      })
      const split = await browser.evaluate<string[]>(`(() => {
        const h3 = document.querySelector('.ab-result h3'), text = ${JSON.stringify(words)}, split = []
        h3.textContent = text
        let at = 0
        for (const word of text.split(' ')) {
          const start = text.indexOf(word, at), range = document.createRange()
          at = start + word.length
          range.setStart(h3.firstChild, start)
          range.setEnd(h3.firstChild, at)
          if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) split.push(word)
        }
        return split
      })()`)
      if (split.length) broken.push(`${width}px: ${split.join(', ')}`)
    }
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 834,
      height: 1112,
      deviceScaleFactor: 1,
      mobile: false,
    })
    assert.deepEqual(broken, [], 'words split across lines')
  })

  test('the rarity sticker never makes the page scroll sideways as it pops in', async () => {
    const wider: string[] = []
    for (const [width, phone] of [
      [821, false],
      [390, true],
    ] as const) {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 844,
        deviceScaleFactor: phone ? 2 : 1,
        mobile: phone,
      })
      await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
      // Pulls, gives the sticker the widest label (SSR!!) as it appears, and measures the page
      // every frame until the pop has settled. Phones widen the page to fit what overflows.
      const wide = await browser.evaluate<number>(`new Promise((resolve) => {
        const label = new MutationObserver(() => {
          const sticker = document.querySelector('.ab-result:not([data-old]) .ab-sfx-tier')
          if (sticker && sticker.textContent !== 'SSR!!') sticker.textContent = 'SSR!!'
        })
        label.observe(document.querySelector('.ab-reveal'), { childList: true, subtree: true })
        document.querySelector('.ab-result')?.setAttribute('data-old', '')
        document.querySelector('.ab-lever').click()
        const start = performance.now()
        let widest = 0
        const frame = () => {
          widest = Math.max(widest, document.documentElement.scrollWidth, innerWidth)
          if (performance.now() - start < 2600) requestAnimationFrame(frame)
          else (label.disconnect(), resolve(widest - ${width}))
        }
        requestAnimationFrame(frame)
      })`)
      if (wide > 0) wider.push(`${width}px: ${wide}px wider`)
    }
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 834,
      height: 1112,
      deviceScaleFactor: 1,
      mobile: false,
    })
    assert.deepEqual(wider, [], 'the page grew wider than the screen')
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

  test('hovering the lever still shows it can be pulled, without moving it', async () => {
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    const at = await browser.evaluate<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('.ab-lever').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
    )
    type Look = { shadow: string; fill: string; transform: string }
    const look = `(() => { const s = getComputedStyle(document.querySelector('.ab-lever')); return { shadow: s.boxShadow, fill: s.backgroundColor, transform: s.transform } })()`
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x - 200, y: at.y })
    await sleep(300)
    const resting = await browser.evaluate<Look>(look)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await sleep(300) // longer than the 0.15s shadow transition
    const hovered = await browser.evaluate<Look>(look)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x - 200, y: at.y })
    assert.ok(
      hovered.shadow !== resting.shadow || hovered.fill !== resting.fill,
      'hovering the lever changed nothing',
    )
    assert.equal(hovered.transform, 'none', 'the hovered lever moved')
  })

  test('the splash cover stays still as the page scrolls it away', async () => {
    // The drift that the desktop check sees with motion allowed must not run here.
    await scrollSplashOut(0.5)
    const halfOut = await browser.evaluate<string>(splashCover)
    await browser.evaluate('scrollTo(0, 0); true')
    assert.equal(halfOut, 'none', 'the splash cover drifted with half its panel scrolled away')
  })

  test('a pull never shows the title already on screen, even once every title has come up', async () => {
    // A pull that lands on the title already showing looks like the lever did nothing. With
    // Math.random fixed, each pull draws the same place in its list: once every title has come
    // up, that is the same title every time, unless the one showing is skipped. Reduced motion
    // opens each capsule at once, so 100 pulls take about a second.
    const shown = await browser.evaluate<(string | null)[]>(`(async () => {
      const random = Math.random
      Math.random = () => 0.5
      const shown = []
      try {
        for (let i = 0; i < 100; i++) {
          document.querySelector('.ab-result')?.setAttribute('data-old', '')
          document.querySelector('.ab-lever').click()
          let panel = null
          for (let wait = 0; wait < 100 && !(panel = document.querySelector('.ab-result.is-open:not([data-old]) .ab-result-panel')); wait++)
            await new Promise((resolve) => setTimeout(resolve, 5))
          shown.push(panel?.getAttribute('href') ?? null)
        }
      } finally {
        Math.random = random
      }
      return shown
    })()`)
    const unopened = shown.flatMap((href, i) => (href ? [] : [i + 1]))
    const repeats = shown.flatMap((href, i) =>
      i > 0 && href === shown[i - 1] ? [`pull ${i + 1}: ${href}`] : [],
    )
    assert.deepEqual(unopened, [], 'pulls that never opened')
    assert.deepEqual(repeats, [], 'pulls that showed the title already on screen')
  })

  test('picking another decade opens it at Ch.1, wherever the last one was scrolled', async () => {
    // The page keeps the decade row for the next decade's titles, so a new decade used to open
    // wherever the visitor had scrolled the last one. With reduced motion nothing pops in, so
    // where the row is when the new titles go in is what the visitor sees.
    const first = `${decadeRow}?.querySelector('.ab-strip-title')?.textContent`
    const nineties = await browser.evaluate<string>(first)
    await browser.evaluate(`document.querySelector('.ab-eras input[value="1980s"]').click(); true`)
    assert.ok(
      await browser.waitFor(`${first} && ${first} !== ${JSON.stringify(nineties)}`),
      'the strip kept the 1990s titles',
    )
    await browser.evaluate(
      `${decadeRow}.scrollTo({ left: ${decadeRow}.scrollWidth, behavior: 'instant' }); true`,
    )
    await rowSettled()
    const scrolled = await browser.evaluate<number>(`${decadeRow}.scrollLeft`)
    // Back to the 1990s, which the page loaded first, so they come from the cache. That switch
    // shows whether the reset waits for paint: React draws cached titles in an update whose
    // effects can run after paint, while a fetched list arrives in one whose effects all run
    // first. The row's place is read as soon as the first title changes, before the browser
    // paints.
    const atSwap = await browser.evaluate<number | null>(`new Promise((resolve) => {
      const section = document.querySelector('[aria-labelledby="decades"]')
      const row = () => section.querySelector('.ab-strip-row:not([aria-hidden])')
      const before = row().querySelector('.ab-strip-title').textContent
      const watch = new MutationObserver(() => {
        if (row()?.querySelector('.ab-strip-title')?.textContent === before) return
        watch.disconnect()
        resolve(row().scrollLeft)
      })
      watch.observe(section, { childList: true, subtree: true })
      setTimeout(() => resolve(null), 5000)
      document.querySelector('.ab-eras input[value="1990s"]').click()
    })`)
    await rowSettled()
    const atRest = await browser.evaluate<number>(`${decadeRow}.scrollLeft`)
    assert.ok(scrolled > 0, 'the 1980s row did not scroll')
    assert.notEqual(atSwap, null, 'the 1990s titles never replaced the 1980s')
    assert.deepEqual(
      { atSwap, atRest },
      { atSwap: 0, atRest: 0 },
      'the 1990s did not open at Ch.1 (the row’s scrollLeft when their titles went in, and at rest)',
    )
  })

  test('opening a title card elsewhere leaves the decade row where the visitor left it', async () => {
    // Only a new list starts at Ch.1. The page draws the strip again, with the same titles,
    // whenever anything on it changes, such as a title card opening or closing; the visitor's
    // place must stay.
    await browser.evaluate(`(() => {
      const row = ${decadeRow}
      row.scrollTo({ left: row.children[5].offsetLeft - parseFloat(getComputedStyle(row).scrollPaddingLeft), behavior: 'instant' })
      return true
    })()`)
    await rowSettled()
    const before = await browser.evaluate<number>(`${decadeRow}.scrollLeft`)
    await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(); true`)
    assert.ok(
      await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
      'the title card did not open',
    )
    await browser.press('Escape')
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000),
      'the title card did not close',
    )
    await rowSettled()
    assert.ok(before > 0, 'the decade row did not scroll')
    assert.equal(
      await browser.evaluate<number>(`${decadeRow}.scrollLeft`),
      before,
      'opening and closing a title card moved the decade row',
    )
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

  test('the intro’s speed lines stay under the header', async () => {
    // The intro's speed lines reach up behind the header. On a phone the header scrolls away
    // with the page instead of sticking, but it should still cover them, as it does on
    // desktop, so it looks the same with the lines hidden.
    await browser.animationsDone()
    await browser.evaluate('scrollTo(0, 0); true')
    const header = await browser.evaluate<{ x: number; y: number; width: number; height: number }>(
      `(() => { const r = document.querySelector('.ab-top').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height } })()`,
    )
    const withLines = await browser.screenshot(header)
    // Hide them, and wait two frames, so the page has painted without them.
    await browser.evaluate(`(() => {
      const style = document.head.appendChild(document.createElement('style'))
      style.id = 'no-speed-lines'
      style.textContent = '.ab-intro::before { content: none }'
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))
    })()`)
    const withoutLines = await browser.screenshot(header)
    await browser.evaluate(`document.getElementById('no-speed-lines').remove(); true`)
    // Not assert.equal, which would print both PNGs in full.
    assert.ok(withLines === withoutLines, 'the intro’s speed lines paint over the header')
  })

  test('with WCAG text spacing, no word in the intro is cut off or pushed out of its box', async () => {
    // Some readers widen the spacing of letters, words and lines to read more easily, and WCAG
    // 1.4.12 asks that no text is lost when they do. With its test spacing on, at two phone
    // widths and a desktop one, this lists each word of the intro that ends up past the intro's
    // padding, where the intro cuts it off, or outside its own box (on desktop, under the
    // covers). The sound effect is decoration (aria-hidden), so it is left out.
    await browser.animationsDone() // the lines rise into place; measure them once they have landed
    await browser.evaluate(`(() => {
      const style = document.head.appendChild(document.createElement('style'))
      style.id = 'text-spacing'
      style.textContent = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important } p { margin-bottom: 2em !important }'
      return true
    })()`)
    const lost: string[] = []
    // All at this describe's 2x density. At 1x, decade covers that come within lazy-loading
    // range of the shorter desktop page would load their 1x file and keep it on the phone,
    // where the 2x cover check below would find them blurry.
    for (const [width, height, mobile] of [
      [390, 844, true],
      [320, 568, true],
      [1024, 768, false],
    ] as const) {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 2,
        mobile,
      })
      const words = await browser.evaluate<string[]>(`(() => {
        const intro = document.querySelector('.ab-intro'), box = intro.getBoundingClientRect(), style = getComputedStyle(intro)
        const left = box.left + parseFloat(style.paddingLeft), right = box.right - parseFloat(style.paddingRight)
        const lost = []
        for (const block of intro.querySelectorAll('.ab-intro-kicker, .ab-intro-title, .ab-intro-lede, .ab-intro-actions a')) {
          const own = block.getBoundingClientRect(), text = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
          for (let node; (node = text.nextNode()); ) {
            if (node.parentElement.closest('[aria-hidden="true"]')) continue
            for (const word of node.data.matchAll(/\\S+/g)) {
              const range = document.createRange()
              range.setStart(node, word.index)
              range.setEnd(node, word.index + word[0].length)
              for (const r of range.getClientRects())
                if (r.left < Math.max(left, own.left) - 0.5 || r.right > Math.min(right, own.right) + 0.5) lost.push(word[0])
            }
          }
        }
        return lost
      })()`)
      lost.push(...words.map((word) => `${width}px: ${word}`))
    }
    // Back to the normal view on this describe's phone before anything is asserted, so the
    // checks after this one see the screen they expect.
    await browser.evaluate(`document.getElementById('text-spacing').remove(); true`)
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    })
    // The sound effect hangs off the end of the first line, with no width of its own, so it
    // must not wrap one katakana per line.
    const effectLines = await browser.evaluate<number>(`(() => {
      const range = document.createRange()
      range.selectNodeContents(document.querySelector('.ab-intro-sfx'))
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
    })()`)
    assert.deepEqual(lost, [], 'words in the intro cut off or pushed out of their box')
    assert.equal(effectLines, 1, 'the intro’s sound effect wraps onto more than one line')
  })

  test('every menu item fits on screen without squeezing', async () => {
    const menu = await browser.evaluate<{ right: number; soonHeight: number }>(`({
      right: Math.max(...[...document.querySelectorAll('.ab-nav > *')].map((n) => n.getBoundingClientRect().right)),
      soonHeight: document.querySelector('.ab-nav .ab-soon').getBoundingClientRect().height,
    })`)
    assert.ok(menu.right <= 374, `the menu ends at ${menu.right}px`)
    assert.ok(menu.soonHeight <= 50, `the coming-soon pill is ${menu.soonHeight}px tall`)
  })

  test('on a 2x screen, decade covers load AniList’s 460px file where there is one', async () => {
    // A decade cover is 142px wide here: 284 pixels on this 2x screen. AniList's `large` file
    // is 230px wide, so it was blown up and looked soft. Where AniList also has a 460px file
    // (extraLarge), a 2x screen should load that one instead.
    assert.equal(await browser.evaluate('devicePixelRatio'), 2, 'the phone checks need a 2x screen')
    await browser.evaluate(`${decadeRow}.scrollIntoView({ block: 'center' }); true`)
    assert.ok(
      await browser.waitFor(
        `[...${decadeRow}.querySelectorAll('img')].slice(0, 2).every((img) => img.complete && img.naturalWidth)`,
      ),
      'the first decade covers never loaded',
    )
    // For each cover that has loaded: whether it offers a bigger file, the size of the file it
    // shows, and the size of its box in device pixels. A 2x file's naturalWidth is halved (460
    // reads 230), so the shown file is loaded again on its own to read its real size.
    type Cover = { title: string; offers: boolean; file: number[]; box: number[] }
    const covers = await browser.evaluate<Cover[]>(`Promise.all(
      [...${decadeRow}.querySelectorAll('img')]
        .filter((img) => img.complete && img.naturalWidth)
        .map(async (img) => {
          const file = new Image()
          file.src = img.currentSrc
          await file.decode()
          return {
            title: img.closest('a').querySelector('.ab-strip-title').textContent,
            offers: img.srcset !== '',
            file: [file.naturalWidth, file.naturalHeight],
            box: [img.offsetWidth, img.offsetHeight].map((px) => px * devicePixelRatio),
          }
        }),
    )`)
    const offering = covers.filter((cover) => cover.offers)
    assert.ok(
      offering.length >= 2,
      `only ${offering.length} of ${covers.length} loaded covers offer a bigger file`,
    )
    assert.deepEqual(
      offering
        .filter(({ file, box }) => file[0] < box[0] || file[1] < box[1])
        .map(
          ({ title, file, box }) => `${title}: a ${file.join('x')} file for a ${box.join('x')} box`,
        ),
      [],
      'covers that offer a bigger file but show a blurry one',
    )
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

describe('Windows contrast themes (forced colors)', () => {
  // A contrast theme replaces the page's colors with a few the visitor picked (forced colors).
  // Chrome emulates one in a light palette and a dark one.
  before(async () => {
    await browser.load({ reduceMotion: true })
    assert.ok(await browser.titlesShown())
  })
  // Emulated media features are replaced as a whole: this clears forced colors.
  after(() => browser.send('Emulation.setEmulatedMedia', { features: [] }))

  test('the chosen decade and vibe stand out, with a readable label and the theme’s focus ring', async () => {
    // The theme drops a chosen chip's yellow fill and its shadow, which left it looking like the
    // rest. It must still differ from an unchosen chip, its label must read at 4.5:1 or better
    // as the screen shows it, and its focus ring must take the theme's text color.
    const problems: string[] = []
    for (const scheme of ['light', 'dark']) {
      // This list replaces the one load() set, so reduced motion goes in again.
      await browser.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-color-scheme', value: scheme },
        ],
      })
      for (const [group, name] of [
        ['.ab-eras', 'decades'],
        ['.ab-moods', 'vibes'],
      ]) {
        // Focuses the chosen chip from the keyboard, so it shows its ring (:focus-visible): Tab
        // out of its group, then Shift+Tab back in.
        await browser.evaluate(
          `document.querySelector('${group}').scrollIntoView({ block: 'center' }); document.querySelector('${group} input:checked').focus(); true`,
        )
        await browser.press('Tab')
        await browser.press('Tab', true)
        // Read after two frames, once the page has painted in the theme's colors.
        const chip = await browser.evaluate<{
          focused: boolean
          same: boolean
          ring: string
          text: string
          label: { x: number; y: number; width: number; height: number }
        }>(`(async () => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          // The theme's text color, as Chrome computes it.
          const probe = document.body.appendChild(document.createElement('i'))
          probe.style.color = 'CanvasText'
          const text = getComputedStyle(probe).color
          probe.remove()
          const [chosen, other] = ['input:checked', 'input:not(:checked)'].map((input) => document.querySelector('${group} ' + input + ' + span'))
          const look = (span) => { const c = getComputedStyle(span); return [c.backgroundColor, c.color, c.borderTopColor].join(' ') }
          const style = getComputedStyle(chosen)
          // The label's text box, in whole pixels from the top left of the page, rounded inward:
          // its edge pixels are partly the chip around it, and those would be measured instead
          // of a label hidden by a plate behind it.
          const range = document.createRange()
          range.selectNodeContents(chosen)
          const r = range.getBoundingClientRect()
          const x = Math.ceil(r.left + scrollX), y = Math.ceil(r.top + scrollY)
          return {
            focused: chosen.previousElementSibling.matches(':focus-visible'),
            same: look(chosen) === look(other),
            ring: style.outlineStyle === 'none' ? 'none' : style.outlineColor,
            text,
            label: { x, y, width: Math.floor(r.right + scrollX) - x, height: Math.floor(r.bottom + scrollY) - y },
          }
        })()`)
        const contrast = await pixelContrast(chip.label)
        const where = `${scheme} ${name}`
        if (!chip.focused) problems.push(`${where}: the chosen chip did not take keyboard focus`)
        if (chip.same) problems.push(`${where}: the chosen chip looks like the others`)
        if (chip.ring !== chip.text)
          problems.push(
            `${where}: its focus ring is ${chip.ring}, not the theme’s text color ${chip.text}`,
          )
        if (contrast < 4.5) problems.push(`${where}: its label reads ${contrast}:1`)
      }
    }
    await browser.evaluate('document.activeElement.blur(); scrollTo(0, 0); true')
    assert.deepEqual(
      problems,
      [],
      'chosen chips that a contrast theme hides, washes out or rings in the wrong color',
    )
  })
})
