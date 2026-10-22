// The development-only component gallery, at ?gallery (see src/gallery/Gallery.tsx). Only the
// dev server has it, so these checks skip unless BASE_URL is the dev server: it alone serves
// Vite's client script. The gallery asks AniList's API for nothing (its covers come from AniList's
// image server, as the app's do), so the API is blocked here as a backstop, and every request to
// it is counted.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { noteFor, searchStatus, statusText } from '../src/app/status.ts'
import { formatOf, seasonOf, studioOf, titleOf } from '../src/features/anime/format.ts'
import { AXES } from '../src/features/mood/moods.ts'
import { mediaOf, STATES, STATUS_CASES, TITLE_CASES } from '../src/gallery/cases.ts'
import { BASE_URL, Browser } from './browser.ts'

const GALLERY = new URL('?gallery', BASE_URL).href
const dev = await fetch(new URL('@vite/client', BASE_URL))
  .then((answer) => answer.ok && /javascript/.test(answer.headers.get('content-type') ?? ''))
  .catch(() => false)
const skip = !dev && `the gallery is development-only, and ${BASE_URL} is not the dev server`
// Most checks below load the gallery with reduced motion, where motion plays no part in what they
// look at: it spares a busy machine the page's 150 entrance animations, during which Chrome has
// been seen to answer nothing for a minute. The first and the last load it with motion allowed.

// In the page: waits, up to 2 seconds, until each cover in the element it is given has loaded or
// been marked broken. A cover that fails is complete a moment before its error event, whose
// onError marks it.
const SETTLE = `async (within) => {
  const covers = [...within.querySelectorAll('img')]
  const settled = () => covers.every((img) => img.complete && (img.naturalWidth > 0 || img.hasAttribute('data-broken')))
  for (let i = 0; i < 40 && !settled(); i++) await new Promise((done) => setTimeout(done, 50))
}`

let browser: Browser
// Requests the page sent AniList, whatever came of them.
const aniList: string[] = []
before(async () => {
  if (!dev) return
  browser = await Browser.open()
  // The page words times as this machine's Node does, so the status lines can be checked against
  // what statusText says here: Chrome's locale otherwise needn't be Node's ("9:30:00 AM" against
  // "09:30:00").
  await browser.send('Emulation.setLocaleOverride', {
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
  })
  await browser.blockAniList()
  await browser.send('Network.enable')
  browser.onEvent('Network.requestWillBeSent', ({ request }) => {
    if (new URL(request.url).hostname === 'graphql.anilist.co') aniList.push(request.method)
  })
})
after(() => browser?.close())

test('?gallery shows the gallery, not the app', { skip }, async () => {
  await browser.load({ url: GALLERY })
  const page = await browser.evaluate<{ heading: string; app: boolean }>(`({
    heading: document.querySelector('main h1')?.textContent ?? '',
    app: Boolean(document.querySelector('#ab-trending, #decades')),
  })`)
  assert.equal(page.heading, 'AniBeam component gallery')
  assert.equal(page.app, false, "the app's sections show under ?gallery")
})

test(
  'every title case shows on the trending page and on the strip, its gap and all',
  { skip },
  async () => {
    await browser.load({ url: GALLERY, reduceMotion: true })
    await browser.evaluate(`(${SETTLE})(document.querySelector('[aria-labelledby="gal-titles"]'))`)
    const shown = await browser.evaluate<{
      listed: string[]
      panels: string[]
      strip: string[]
      broken: boolean[]
      small: string
      wide: string
      banner: boolean
      splash: boolean
    }>(`(() => {
    const panels = [...document.querySelectorAll('[aria-labelledby="gal-panels"] .ab-grid > li')]
    const strip = [...document.querySelectorAll('[aria-labelledby="gal-strip"] .ab-strip-item')]
    const titles = (items, selector) => items.map((item) => item.querySelector(selector)?.textContent ?? '')
    const at = (label) => ${JSON.stringify(TITLE_CASES.map(({ label }) => label))}.indexOf(label)
    return {
      listed: [...document.querySelectorAll('.gal-cases > li > b')].map((b) => b.textContent),
      panels: titles(panels, '.ab-caption b'),
      strip: titles(strip, '.ab-strip-title'),
      broken: [panels, strip].map((items) => items[at('A cover that fails to load')]?.querySelector('img')?.hasAttribute('data-broken')),
      small: panels[at('The small 230px cover')]?.querySelector('img')?.getAttribute('src') ?? '',
      wide: strip[at('A wide cover')]?.querySelector('img')?.getAttribute('src') ?? '',
      banner: Boolean(panels[at('No banner')]?.querySelector('source')),
      splash: panels.findIndex((panel) => panel.classList.contains('ab-splash')) === at('No banner'),
    }
  })()`)
    const titles = TITLE_CASES.map((edge) => titleOf(mediaOf(edge)))
    assert.deepEqual(
      shown.listed,
      TITLE_CASES.map(({ label }) => label),
      'the list of cases',
    )
    assert.deepEqual(shown.panels, titles.slice(0, 9), "the trending page's panels")
    assert.deepEqual(shown.strip, titles, "the strip's covers")
    assert.deepEqual(
      shown.broken,
      [true, true],
      'the cover that fails to load is not marked broken',
    )
    assert.match(shown.small, /\/cover\/medium\//, 'the small cover case shows a big cover')
    assert.match(shown.wide, /\/10743\.jpg$/, 'the wide cover case shows another cover')
    // Only the splash panel shows a banner, so the case is seen only there.
    assert.equal(shown.splash, true, 'the no-banner case is not on the splash panel')
    assert.equal(shown.banner, false, 'the splash panel offers a banner it has not got')
  },
)

test('nothing on the gallery scrolls sideways, on a phone or a wide screen', { skip }, async () => {
  const wider: string[] = []
  for (const screen of [
    { width: 390, height: 844, phone: true },
    { width: 1440, height: 900 },
  ]) {
    await browser.load({ url: GALLERY, ...screen, reduceMotion: true })
    const page = await browser.evaluate<{ scroll: number; view: number }>(
      `({ scroll: document.documentElement.scrollWidth, view: document.documentElement.clientWidth })`,
    )
    if (page.scroll > page.view) wider.push(`${screen.width}px: ${page.scroll}px wide`)
  }
  assert.deepEqual(wider, [], 'the gallery scrolls sideways')
})

test('every state of each section shows, each as it should', { skip }, async () => {
  await browser.load({ url: GALLERY, reduceMotion: true })
  // Each group's states, as their labels, and what each shows.
  const shown = await browser.evaluate<Record<string, { label: string; look: string }[]>>(`(() => {
    const looks = {
      page: (state) => {
        const panels = state.querySelectorAll('.ab-grid:not([aria-hidden]) > li')
        return [
          panels.length + ' panels',
          state.querySelectorAll('.ab-skeleton').length + ' empty',
          state.querySelectorAll('.ab-rank').length + ' ranked',
          state.querySelector('.ab-retry') ? 'Try again' : 'no Try again',
          state.querySelector('h2')?.textContent ?? '',
        ].join(', ')
      },
      strip: (state) => [
        state.querySelectorAll('.ab-strip-row:not([aria-hidden]) > li').length + ' covers',
        state.querySelectorAll('.ab-strip-row[aria-hidden] > li').length + ' empty',
        state.querySelector('.ab-strip-grid') ? 'a grid' : 'a row',
        state.querySelector('.ab-note')?.textContent ?? '',
      ].join(', '),
      lines: (state) => [...state.querySelectorAll('dd')].map((dd) => dd.textContent).join(' | '),
      controls: (state) => [...state.querySelectorAll('button, .ab-soon')].map((part) => part.textContent.replace(/\\s+/g, ' ').trim() + (part.hasAttribute('aria-pressed') ? ', pressed ' + part.getAttribute('aria-pressed') : '')).join(' | '),
    }
    return Object.fromEntries(Object.entries(looks).map(([group, look]) => [
      group,
      [...document.querySelectorAll('[data-group="' + group + '"] > [data-case]')].map((state) => ({ label: state.dataset.case, look: look(state) })),
    ]))
  })()`)
  const lines = Object.values(STATUS_CASES).map(({ label, status, rateLimited = false }) => ({
    label,
    look: [
      statusText(status, rateLimited),
      `Section note: ${noteFor(status, rateLimited) ?? 'none'}`,
      `Search: ${searchStatus(status, 'frieren', rateLimited)}`,
    ].join(' | '),
  }))
  assert.deepEqual(
    shown.page,
    [
      '0 panels, 9 empty, 0 ranked, no Try again, Trending nowドン!',
      '0 panels, 0 empty, 0 ranked, Try again, Trending nowドン!',
      '9 panels, 0 empty, 0 ranked, no Try again, Fan favoritesドン!',
      '4 panels, 0 empty, 4 ranked, no Try again, Trending nowドン!',
    ].map((look, i) => ({ label: STATES.page[i], look })),
    "the trending page's states",
  )
  assert.deepEqual(
    shown.strip,
    [
      '17 covers, 0 empty, a row, ',
      '17 covers, 0 empty, a grid, ',
      '0 covers, 8 empty, a row, Loading…',
      '0 covers, 0 empty, a grid, No titles found.',
    ].map((look, i) => ({ label: STATES.strip[i], look })),
    "the strip's states",
  )
  assert.deepEqual(shown.lines, lines, 'the status lines')
  assert.deepEqual(
    shown.controls,
    [
      { label: 'Buttons', look: 'Try again' },
      {
        label: 'My List row',
        look: 'Save, pressed true | Want to try, pressed false | Favorite, pressed true',
      },
      { label: 'Chips', look: '' },
      { label: 'Soon tags', look: 'My List Soon' },
      { label: 'Accent swatches', look: '' },
    ],
    'the controls',
  )
})

test(
  'the intro and the pull machine show each of their states, one at a time',
  { skip },
  async () => {
    await browser.load({ url: GALLERY, reduceMotion: true })
    const looks: Record<string, string> = {}
    for (const group of ['intro', 'pull'] as const)
      for (const state of STATES[group]) {
        // Picked as a visitor picks it: a click on its chip.
        await browser.evaluate(`(() => {
        const chips = [...document.querySelectorAll('[data-group="${group}"] .gal-pick label')]
        chips.find((chip) => chip.textContent === ${JSON.stringify(state)})?.querySelector('input').click()
        return true
      })()`)
        looks[`${group}: ${state}`] = await browser.evaluate<string>(`(async () => {
        const shown = [...document.querySelectorAll('[data-group="${group}"] > [data-case]')]
        if (shown.length !== 1) return shown.length + ' states shown'
        const [state] = shown
        await (${SETTLE})(state)
        return [state.dataset.case, ${
          group === 'intro'
            ? `state.querySelectorAll('.ab-intro-cover').length + ' covers', state.querySelectorAll('.ab-intro-cover img[data-broken]').length + ' broken', state.querySelector('.ab-intro-art.is-loading') ? 'loading' : 'not loading'`
            : `state.querySelector('.ab-lever').disabled ? 'lever off' : 'lever on', state.querySelectorAll('.ab-capsule').length + ' capsules', state.querySelector('.ab-hint')?.textContent.split('.')[0] ?? ''`
        }].join(', ')
      })()`)
        // A pull here must not carry over to the next state, which starts afresh.
        if (state === 'The samples')
          await browser.evaluate(`document.querySelector('[data-group="pull"] .ab-lever').click()`)
      }
    assert.deepEqual(
      looks,
      {
        'intro: 3 covers': '3 covers, 3 covers, 0 broken, not loading',
        'intro: Covers with gaps': 'Covers with gaps, 3 covers, 1 broken, not loading',
        'intro: Loading': 'Loading, 0 covers, 0 broken, loading',
        'intro: No covers': 'No covers, 0 covers, 0 broken, not loading',
        'pull: Nothing to pull yet':
          'Nothing to pull yet, lever off, 0 capsules, The machine fills up with titles once AniList answers',
        'pull: Nothing it may hand out (all Ecchi)':
          'Nothing it may hand out (all Ecchi), lever off, 0 capsules, None of the titles on this page can come out of the machine',
        'pull: The samples': 'The samples, lever on, 9 capsules, Pick a vibe, then pull',
        'pull: The title cases': 'The title cases, lever on, 9 capsules, Pick a vibe, then pull',
      },
      "the intro's and the pull machine's states",
    )
  },
)

test(
  "each title case's card opens from the strip, shows its gap, and Esc closes it with focus back",
  { skip },
  async () => {
    // Reduced motion, so each card fades in and out in 150 ms.
    await browser.load({ url: GALLERY, reduceMotion: true })
    const cards: Record<string, string> = {}
    for (const [i, edge] of TITLE_CASES.entries()) {
      const panel = `document.querySelectorAll('[aria-labelledby="gal-strip"] .ab-strip-panel')[${i}]`
      await browser.evaluate(`${panel}.focus()`)
      await browser.press('Enter')
      const opened = await browser.waitFor(`document.querySelector('dialog.ab-card[open]')`, 5000)
      cards[edge.label] = opened
        ? await browser.evaluate<string>(`(async () => {
          const card = document.querySelector('dialog.ab-card')
          const img = card.querySelector('.ab-sheet-art img')
          await (${SETTLE})(card)
          const fact = (name) => [...card.querySelectorAll('.ab-facts > div')].find((fact) => fact.querySelector('dt').textContent === name)?.querySelector('dd').textContent ?? 'none'
          return [
            card.querySelector('#ab-card-title').textContent.trim(),
            card.querySelector('.ab-kicker').textContent,
            'native ' + (card.querySelector('.ab-native')?.textContent ?? 'none'),
            'genres ' + (card.querySelector('.ab-genres') ? card.querySelectorAll('.ab-genres li').length : 'none'),
            'score ' + fact('Score'),
            'episodes ' + fact('Episodes'),
            'next ' + fact('Next'),
            img.hasAttribute('data-broken') ? 'cover broken' : 'cover shown',
          ].join(' | ')
        })()`)
        : 'did not open'
      await browser.press('Escape')
      const closed = await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000)
      const back = await browser.evaluate<boolean>(`document.activeElement === ${panel}`)
      if (!closed || !back) cards[edge.label] += closed ? ' | focus not back' : ' | still open'
    }
    const expected = (edge: (typeof TITLE_CASES)[number], gap: Partial<Record<string, string>>) => {
      const media = mediaOf(edge)
      return [
        titleOf(media),
        [seasonOf(media), formatOf(media), studioOf(media)].filter(Boolean).join(' · '),
        `native ${gap.native ?? media.title.native}`,
        `genres ${gap.genres ?? Math.min(4, media.genres.length)}`,
        `score ${gap.score ?? `${media.averageScore}%`}`,
        `episodes ${gap.episodes ?? media.episodes}`,
        `next ${gap.next ?? 'none'}`,
        gap.cover ?? 'cover shown',
      ].join(' | ')
    }
    const gaps: Record<string, Partial<Record<string, string>>> = {
      'No score': { score: 'Not rated yet' },
      'A cover that fails to load': { cover: 'cover broken' },
      'No genres, studio or episode count': { genres: 'none', episodes: 'TBA' },
      'No native title': { native: 'none' },
      'An episode countdown': { next: 'Ep 9 in 2d 4h' },
    }
    assert.deepEqual(
      cards,
      Object.fromEntries(
        TITLE_CASES.map((edge) => [edge.label, expected(edge, gaps[edge.label] ?? {})]),
      ),
      "the title cases' cards",
    )
  },
)

test(
  "the title card's status line shows in each of its states, and Esc closes the card with focus back",
  { skip },
  async () => {
    // Reduced motion, so each card fades in and out in 150 ms.
    await browser.load({ url: GALLERY, reduceMotion: true })
    const lines: Record<string, unknown> = {}
    for (const label of ['AniList busy (429), trying again', 'Its tries ended, with Try again']) {
      const button = `document.querySelector('[data-group="card-status"] > [data-case="${label}"] button')`
      if (!(await browser.evaluate<boolean>(`Boolean(${button})`))) {
        lines[label] = 'no button opens its card'
        continue
      }
      await browser.evaluate(`${button}.focus()`)
      await browser.press('Enter')
      const shown = await browser.waitFor(
        `document.querySelector('dialog.ab-card[open] .ab-card-status.is-shown')`,
        5000,
      )
      lines[label] = shown
        ? await browser.evaluate(`(() => {
          const line = document.querySelector('dialog.ab-card[open] .ab-card-status'), box = line.getBoundingClientRect()
          return {
            text: line.querySelector('p').textContent,
            role: line.querySelector('p').getAttribute('role'),
            buttons: [...line.querySelectorAll('button')].map((button) => button.textContent.trim()),
            whole: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
          }
        })()`)
        : 'no status line'
      await browser.press('Escape')
      const closed = await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000)
      const back = await browser.evaluate<boolean>(`document.activeElement === ${button}`)
      if (!closed || !back) lines[label] = closed ? 'focus not back' : 'still open'
    }
    assert.deepEqual(
      lines,
      {
        'AniList busy (429), trying again': {
          text: 'AniList is busy right now. It’s not something you did. Trying again within a minute.',
          role: 'status',
          buttons: [],
          whole: true,
        },
        'Its tries ended, with Try again': {
          text: 'AniList, where AniBeam gets its anime, isn’t responding right now. It’s not something you did. Try again in a minute.',
          role: 'status',
          buttons: ['Try again'],
          whole: true,
        },
      },
      "the card's status lines",
    )
  },
)

test(
  'a mood slider is a native range of 5 stops, reads its word by keyboard, and is 44px tall',
  { skip },
  async () => {
    await browser.load({ url: GALLERY, reduceMotion: true })
    // What the focused element is, if it is a slider.
    const focused = () =>
      browser.evaluate<string>(`(() => {
      const input = document.activeElement
      if (input?.type !== 'range') return 'not a slider: ' + (input?.tagName ?? 'nothing')
      const slider = input.closest('.ab-slider')
      return [
        [...input.labels].map((label) => label.textContent).join(),
        input.min + ' to ' + input.max + ' by ' + input.step,
        input.getAttribute('aria-valuetext'),
        slider.querySelector('.ab-slider-value').textContent,
        slider.querySelector('output') ? 'an output' : 'plain text',
        // A screen reader hears the word from the input; shown beside it, it would be read twice.
        ['.ab-slider-value', '.ab-slider-ends'].every((part) => slider.querySelector(part)?.getAttribute('aria-hidden') === 'true')
          ? 'hidden from screen readers'
          : 'read by screen readers too',
        input.getBoundingClientRect().height >= 44 ? '44px or taller' : input.getBoundingClientRect().height + 'px tall',
      ].join(' | ')
    })()`)
    const read: string[] = []
    // From the part's heading, Tab reaches the first slider, Energy, at no preference.
    await browser.evaluate(`document.getElementById('gal-slider')?.focus(); true`)
    await browser.press('Tab')
    read.push(await focused())
    for (const key of ['ArrowRight', 'ArrowRight', 'Home', 'End', 'ArrowLeft'] as const) {
      await browser.press(key)
      read.push(await focused())
    }
    const as = (word: string) =>
      `Energy | -2 to 2 by 1 | ${word} | ${word} | plain text | hidden from screen readers | 44px or taller`
    assert.deepEqual(
      read,
      [
        'No preference',
        'High-octane',
        'Very high-octane',
        'Very cozy',
        'Very high-octane',
        'High-octane',
      ].map(as),
      'the energy slider, after Tab, two Right arrows, Home, End and a Left arrow',
    )
    // Every axis, on paper and on the machine, is named by its own label.
    const names = await browser.evaluate<string[]>(
      `[...document.querySelectorAll('[data-group="sliders"] input[type="range"]')].map((input) => [...input.labels].map((label) => label.textContent).join())`,
    )
    assert.deepEqual(
      names,
      ['Energy', 'Tone', 'Complexity', 'Energy', 'Tone', 'Complexity'],
      "the sliders' names",
    )
  },
)

test(
  'every mood slider is in the accessibility tree, a slider named by its axis',
  { skip },
  async () => {
    await browser.load({ url: GALLERY, reduceMotion: true })
    // What a screen reader is handed, from Chrome's accessibility tree, not the page's attributes:
    // something hidden from it, such as by an aria-hidden around it, is ignored there.
    const { root } = await browser.send('DOM.getDocument', { depth: 0 })
    const { nodeIds } = await browser.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: '[data-group="sliders"] input[type="range"]',
    })
    const seen: string[] = []
    for (const nodeId of nodeIds as number[]) {
      const { nodes } = await browser.send('Accessibility.getPartialAXTree', {
        nodeId,
        fetchRelatives: false,
      })
      const [node] = nodes
      seen.push(`${node.ignored ? 'ignored' : 'exposed'} ${node.role?.value} "${node.name?.value}"`)
    }
    // The machine's labels are set in capitals, which Chrome passes on: the user chose to keep it
    // so, as the machine's "PICK A VIBE" is.
    assert.deepEqual(
      seen,
      ['Energy', 'Tone', 'Complexity', 'ENERGY', 'TONE', 'COMPLEXITY'].map(
        (name) => `exposed slider "${name}"`,
      ),
      "the sliders, as Chrome's accessibility tree has them",
    )
  },
)

test(
  "each slider's end labels sit at its track's ends, as its stops run, low end on the left",
  { skip },
  async () => {
    await browser.load({ url: GALLERY, reduceMotion: true })
    // The labels in the order the screen shows them, left to right, whatever the markup's order.
    const ends = await browser.evaluate<string[][]>(
      `[...document.querySelectorAll('[data-group="sliders"] .ab-slider-ends')].map((ends) =>
      [...ends.children].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((end) => end.textContent))`,
    )
    const axes = Object.values(AXES).map(({ ends }) => [...ends])
    assert.deepEqual(ends, [...axes, ...axes], "the sliders' end labels, left to right")
  },
)

/**
 * The pixels of part of the page as the screen shows it, as red, green and blue for each pixel,
 * row by row. The clip is in CSS pixels from the top left of the page, as for Browser.screenshot.
 */
async function screenPixels(clip: { x: number; y: number; width: number; height: number }) {
  const png = await browser.screenshot(clip)
  // Decoded in the page.
  return browser.evaluate<{ width: number; rgb: number[] }>(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    return { width: image.width, rgb: [...data].filter((_, i) => i % 4 !== 3) }
  })()`)
}

/** WCAG's relative luminance of a color given as red, green and blue from 0 to 255. */
const luminance = (rgb: number[]) =>
  rgb
    .map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, k) => sum + v * [0.2126, 0.7152, 0.0722][k], 0)

/** The paper energy slider, scrolled into view, its box on the page, with focus on it. */
async function energySlider() {
  return browser.evaluate<{ x: number; y: number; width: number; height: number }>(`(() => {
    const input = document.querySelector('[data-group="sliders"] input[type="range"]')
    input.scrollIntoView({ block: 'center', behavior: 'instant' })
    input.focus()
    const box = input.getBoundingClientRect()
    return { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height }
  })()`)
}

test(
  "the slider's thumb rests on a stop dot at each stop, and the dots show where it isn't",
  { skip },
  async () => {
    await browser.load({ url: GALLERY, reduceMotion: true })
    const box = await energySlider()
    const middle = Math.round(box.height / 2)
    await browser.press('Home')
    // Where the thumb is at each stop: the middle of its yellow top half, 10px above the track's
    // middle, read off the screen. And how high: its top half is yellow and its bottom half white,
    // so its middle is where the yellow ends, down the column through its middle.
    const centers: number[] = []
    const heights: number[] = []
    for (let stop = 0; stop < 5; stop++) {
      const { width, rgb } = await screenPixels(box)
      const at = (x: number, y: number) => rgb.slice((y * width + x) * 3, (y * width + x) * 3 + 3)
      const isYellow = ([r, g, b]: number[]) => r > 230 && g > 190 && g < 230 && b < 60
      const yellow = [...Array(width).keys()].filter((x) => isYellow(at(x, middle - 10)))
      centers.push(yellow.length ? (yellow[0] + yellow.at(-1)!) / 2 : NaN)
      const column = Math.round(centers.at(-1)!)
      const rows = [...Array(Math.round(box.height)).keys()].filter((y) => isYellow(at(column, y)))
      heights.push(rows.length ? rows.at(-1)! + 1 : NaN)
      await browser.press('ArrowRight')
    }
    assert.ok(
      centers.every((x) => !Number.isNaN(x)),
      `no yellow thumb at some stops: ${centers}`,
    )
    assert.ok(
      heights.every((y) => Math.abs(y - middle) <= 1),
      `the thumb's middle sits at ${heights.join(', ')}px down, not on the track's middle, ${middle}px`,
    )
    // With the thumb at one end, then the other, each stop it left shows an ink dot under its
    // middle, and the track between two stops is white.
    const seen: string[] = []
    for (const key of ['Home', 'End'] as const) {
      await browser.press(key)
      const { width, rgb } = await screenPixels(box)
      const at = (x: number) =>
        rgb.slice((middle * width + Math.round(x)) * 3, (middle * width + Math.round(x)) * 3 + 3)
      const left = key === 'Home' ? centers.slice(1) : centers.slice(0, 4)
      for (const x of left) if (luminance(at(x)) > 0.05) seen.push(`${key}: no dot at ${x}px`)
      for (let k = 0; k < left.length - 1; k++) {
        const between = (left[k] + left[k + 1]) / 2
        if (luminance(at(between)) < 0.8) seen.push(`${key}: the track isn't white at ${between}px`)
      }
    }
    assert.deepEqual(seen, [], `the thumb's stops: ${centers.join(', ')}`)
    // The thumb is 40px wide and moves inside the track's 3px border: its middle goes from 23px in
    // at one end to 23px in at the other, a quarter of the way at each stop.
    const expected = [0, 1, 2, 3, 4].map((k) => 23 + ((box.width - 46) * k) / 4)
    assert.ok(
      centers.every((x, k) => Math.abs(x - expected[k]) <= 1.5),
      `the thumb's stops: ${centers.join(', ')}, not ${expected.join(', ')}`,
    )
  },
)

test("in contrast themes, the slider's thumb stands out from its track", { skip }, async () => {
  const seen: string[] = []
  for (const scheme of ['light', 'dark']) {
    await browser.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'forced-colors', value: 'active' },
        { name: 'prefers-color-scheme', value: scheme },
      ],
    })
    await browser.load({ url: GALLERY })
    await browser.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'forced-colors', value: 'active' },
        { name: 'prefers-color-scheme', value: scheme },
      ],
    })
    const box = await energySlider()
    const { width, rgb } = await screenPixels(box)
    const middle = Math.round(box.height / 2)
    const at = (x: number, y: number) =>
      rgb.slice((y * width + Math.round(x)) * 3, (y * width + Math.round(x)) * 3 + 3)
    // The thumb sits in the middle, at no preference; the track is read between the first two
    // stops, clear of the dots.
    const thumb = luminance(at(box.width / 2, middle - 8))
    const track = luminance(at(23 + (box.width - 46) / 8, middle))
    const ratio = (Math.max(thumb, track) + 0.05) / (Math.min(thumb, track) + 0.05)
    if (ratio < 3) seen.push(`${scheme}: ${ratio.toFixed(2)}:1`)
  }
  await browser.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'forced-colors', value: 'none' }],
  })
  assert.deepEqual(seen, [], 'the thumb against the track, under 3:1')
})

test(
  "a focused slider's ring is brand red on paper and white on the machine's red body",
  { skip },
  async () => {
    await browser.load({ url: GALLERY, reduceMotion: true })
    await browser.evaluate(`document.getElementById('gal-slider')?.focus(); true`)
    const rings: string[] = []
    // Tab through the three on paper, then the three on the machine.
    for (let i = 0; i < 6; i++) {
      await browser.press('Tab')
      rings.push(
        await browser.evaluate<string>(`(() => {
        const input = document.activeElement, style = getComputedStyle(input)
        return input.type === 'range' && input.matches(':focus-visible')
          ? style.outlineStyle + ' ' + style.outlineWidth + ' ' + style.outlineColor
          : 'not a slider with a keyboard focus ring'
      })()`),
      )
    }
    const red = 'solid 4px rgb(255, 45, 85)'
    const white = 'solid 4px rgb(255, 255, 255)'
    assert.deepEqual(rings, [red, red, red, white, white, white], "the sliders' focus rings")
  },
)

test(
  "the gallery's state pickers show a brand red focus ring on the paper, whole",
  { skip },
  async () => {
    await browser.load({ url: GALLERY, reduceMotion: true })
    // A key pressed first, so that focus given from here shows its ring, as the keyboard's does.
    await browser.press('Tab')
    // Each chip's ring, and whether anything around it cuts the ring off: a box that hides what
    // overflows it must hold the whole ring, its width and its offset out from the chip.
    const ring = (chip: string) => `(() => {
    const input = ${chip}
    input.focus()
    const label = input.nextElementSibling, style = getComputedStyle(label)
    if (!input.matches(':focus-visible')) return 'no focus ring'
    const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)
    const box = label.getBoundingClientRect()
    let cut = ''
    for (let around = label.parentElement; around && around !== document.body; around = around.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(around)
      if (overflowX === 'visible' && overflowY === 'visible') continue
      const room = around.getBoundingClientRect()
      if (box.left - reach < room.left || box.right + reach > room.right || box.top - reach < room.top || box.bottom + reach > room.bottom)
        cut = ', cut off by ' + around.tagName.toLowerCase() + '.' + around.className
    }
    return style.outlineStyle + ' ' + style.outlineWidth + ' ' + style.outlineColor + cut
  })()`
    const rings: string[] = []
    const chips = await browser.evaluate<number>(
      `document.querySelectorAll('.gal-pick input').length`,
    )
    for (let i = 0; i < chips; i++)
      rings.push(
        await browser.evaluate<string>(ring(`document.querySelectorAll('.gal-pick input')[${i}]`)),
      )
    assert.deepEqual(
      rings,
      Array(8).fill('solid 4px rgb(255, 45, 85)'),
      "the 8 pickers' focus rings (white, the machine's ring, vanishes into the paper)",
    )
    // In a contrast theme, the theme's own ring, as the app's decade chips take it.
    await browser.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'forced-colors', value: 'active' },
        { name: 'prefers-color-scheme', value: 'dark' },
      ],
    })
    const themed = await browser.evaluate<string>(
      ring(`document.querySelector('.gal-pick input:checked')`),
    )
    const decade = await browser.evaluate<string>(
      ring(`document.querySelector('.ab-eras input:checked')`),
    )
    await browser.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'none' }],
    })
    assert.equal(
      themed,
      decade,
      "in a contrast theme, a chosen picker's ring against a decade chip's",
    )
  },
)

// Last, so it covers every check above. It loads the gallery once more itself, so that run on its
// own it still looks at something.
test(
  'across the checks above, the console stayed clean and AniList got no request',
  { skip },
  async () => {
    await browser.load({ url: GALLERY })
    await browser.animationsDone()
    assert.deepEqual(browser.problems, [], 'the console has errors or warnings')
    assert.deepEqual(aniList, [], 'the gallery sent AniList requests')
  },
)
