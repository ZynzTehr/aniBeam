// A first-time visitor while AniList is unreachable: sample titles with friendly messages, then
// Try again. Slow on purpose: after a failed connection the AniList client waits a minute before
// retrying.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { titleOf } from '../src/features/anime/format.ts'
import { SAMPLES } from '../src/features/anime/samples.ts'
import { deriveAccent } from '../src/features/theming/deriveAccent.ts'
import { Browser } from './browser.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open() // a fresh profile: nothing saved, like a first visit
})
after(() => browser?.close())

const notes = `[...document.querySelectorAll('.ab-note')].map((note) => note.textContent)`

// Where the headline sits inside the intro: it must not move when the covers arrive.
const headline = `document.querySelector('.ab-intro-title').getBoundingClientRect().top - document.querySelector('.ab-intro').getBoundingClientRect().top`

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
test('covers that can’t load show no broken-image icon, and each panel shows its title’s color instead, darkened so its rank stands out', async () => {
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
    // A pure blue cover's fill is among the darkest a title gets (lightened only to 4.5:1 on ink),
    // so a rank in it stands out least. Panel 1 tries it too, in case today's titles are all light.
    const blue = deriveAccent('#0000ff').accent
    // Two frames on, so every failed cover's error event has been handled.
    const covers = await browser.evaluate<{
      failed: string[]
      shown: string[]
      faint: string[]
      unshaded: string[]
    }>(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))).then(() => {
      const place = (img) => img.parentElement.closest('[class]').classList[0]
      const failed = [...document.images].filter((img) => img.complete && img.naturalWidth === 0)
      const swatch = document.body.appendChild(document.createElement('i'))
      const rgb = (color) => {
        swatch.style.color = color
        return getComputedStyle(swatch).color
      }
      // WCAG luminance, read from a pixel painted in the color, so any color syntax works.
      const pixel = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
      const luminance = (color) => {
        pixel.clearRect(0, 0, 1, 1)
        pixel.fillStyle = color
        pixel.fillRect(0, 0, 1, 1)
        const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        const [r, g, b] = pixel.getImageData(0, 0, 1, 1).data
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
      }
      // A rank is filled with its title's color, so the panel behind it must differ by 3:1.
      const faintRank = (link, name) => {
        const fill = getComputedStyle(link.querySelector('.ab-rank')).color
        const panel = getComputedStyle(link).backgroundColor
        const [light, dark] = [luminance(fill), luminance(panel)].sort((a, b) => b - a)
        const ratio = (light + 0.05) / (dark + 0.05)
        return ratio >= 3 ? [] : [name + ': ' + fill + ' on ' + panel + ', ' + ratio.toFixed(2) + ':1']
      }
      const links = [...document.querySelectorAll('.ab-grid .ab-link')]
      const faint = links.flatMap((link, i) => faintRank(link, 'panel ' + (i + 1)))
      links[0].style.setProperty('--anime-accent', '${blue}')
      faint.push(...faintRank(links[0], 'panel 1 in ${blue}'))
      links[0].style.removeProperty('--anime-accent')
      // The shade is a third of the title's color, mixed with two thirds ink (see .ab-link).
      const unshaded = links.flatMap((link, i) => {
        const fill = getComputedStyle(link).backgroundColor
        const shade = rgb('color-mix(in oklab, ' + getComputedStyle(link).getPropertyValue('--anime-accent') + ' 33%, var(--ink))')
        return fill === shade ? [] : ['panel ' + (i + 1) + ': ' + fill + ', not ' + shade]
      })
      swatch.remove()
      return {
        failed: [...new Set(failed.map(place))].sort(),
        shown: failed.filter((img) => img.checkVisibility({ visibilityProperty: true })).map(place),
        faint,
        unshaded,
      }
    })`)
    await browser.press('Escape')
    assert.deepEqual(
      covers.failed,
      ['ab-img', 'ab-intro-cover', 'ab-result-panel', 'ab-sheet-art', 'ab-strip-panel'],
      'places where no cover failed to load, so they went unchecked',
    )
    assert.deepEqual(covers.shown, [], 'covers that failed to load still show, as broken images')
    assert.deepEqual(covers.faint, [], 'rank numbers that don’t stand out from their panel at 3:1')
    assert.deepEqual(covers.unshaded, [], 'panels that don’t show a shade of their title’s color')
  } finally {
    // Covers load again for the checks below.
    await browser.send('Network.setBlockedURLs', { urls: [] })
    await browser.send('Network.disable')
  }
})

// On a phone the intro's covers sit above the headline, so a cover that can't load keeps its
// place, in its title's color as a trending panel does. When failed covers dropped out of the
// fan, the headline jumped 77px up just after it was drawn. The titles come from the saved copy
// again, so this asks AniList for none.
test('on a phone, intro covers that can’t load keep their place in their title’s color', async () => {
  // Where the headline sits, a frame at a time, from the frame the covers appear in.
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__headline = []
      requestAnimationFrame(function sample() {
        if (document.querySelector('.ab-intro-art img')) {
          const top = Math.round(${headline})
          if (window.__headline.at(-1) !== top) window.__headline.push(top)
        }
        requestAnimationFrame(sample)
      })`,
  })
  await browser.send('Network.enable')
  await browser.send('Network.setBlockedURLs', { urls: ['*s4.anilist.co*'] })
  try {
    await browser.load({ width: 390, height: 844, phone: true })
    const covers = `[...document.querySelectorAll('.ab-intro-art img')]`
    assert.ok(
      await browser.waitFor(
        `${covers}.length === 3 && ${covers}.every((img) => img.complete && !img.naturalWidth)`,
      ),
      'the intro’s covers never failed to load, so there is nothing to check',
    )
    // Two frames on, so every failed cover's error event has been handled. Each cover carries
    // its title's color as --anime-accent (see accentVars); its frame should show that color.
    const page = await browser.evaluate<{ headline: number[]; shown: string[]; colors: string[] }>(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))).then(() => {
        const swatch = document.body.appendChild(document.createElement('i'))
        const rgb = (color) => {
          swatch.style.color = color
          return getComputedStyle(swatch).color
        }
        const shows = (frame) =>
          frame.checkVisibility({ visibilityProperty: true }) ? getComputedStyle(frame).backgroundColor : 'nothing'
        const page = {
          headline: window.__headline,
          shown: ${covers}.map((img) => shows(img.parentElement)),
          colors: ${covers}.map((img) => rgb(getComputedStyle(img).getPropertyValue('--anime-accent'))),
        }
        swatch.remove()
        return page
      })`,
    )
    const moved = Math.max(...page.headline) - Math.min(...page.headline)
    assert.ok(
      moved <= 2,
      `the headline moved ${moved}px as the covers failed (${page.headline.join(' → ')}px)`,
    )
    assert.deepEqual(page.shown, page.colors, 'failed covers that don’t show their title’s color')
  } finally {
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    await browser.send('Network.setBlockedURLs', { urls: [] })
    await browser.send('Network.disable')
  }
})

// From 900px wide the splash panel shows its title's banner, and below that its cover, in the
// same img: narrowing the window or turning a tablet swaps one file for the other. A banner that
// failed must not keep the cover hidden once it loads. With AniList kept away, the panels show
// the samples, so the splash title has a banner whatever is trending, and no request is sent.
test('the splash panel shows its cover when the window narrows, even after its banner failed', async () => {
  await browser.forget()
  await browser.blockAniList()
  await browser.send('Network.enable')
  await browser.send('Network.setBlockedURLs', { urls: ['*/banner/*'] })
  const splash = `document.querySelector('.ab-splash img')`
  try {
    await browser.load({ width: 1280, height: 900 })
    assert.ok(
      await browser.waitFor(
        `${splash}?.currentSrc.includes('/banner/') && ${splash}.complete && !${splash}.naturalWidth`,
        15_000,
      ),
      'the splash panel’s banner never failed, so there is nothing to check',
    )
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    assert.ok(
      await browser.waitFor(`${splash}.complete && ${splash}.naturalWidth > 0`),
      'the splash panel’s cover never loaded below 900px',
    )
    // Two frames on, so the cover's load event has been handled.
    const shown = await browser.evaluate<boolean>(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))).then(() => ${splash}.checkVisibility({ visibilityProperty: true }))`,
    )
    assert.equal(shown, true, 'the cover loaded but stays hidden, as if it had failed')
  } finally {
    await browser.send('Network.setBlockedURLs', { urls: [] })
    await browser.send('Network.disable')
    await browser.blockAniList(false)
  }
})

// Spec §3H: a section that can't reach AniList shows bundled sample titles instead of an empty
// page, and says what they are. Trending shows the first 9; the decade strip, the open decade's.
describe('AniList down on a first visit', () => {
  const nineties = SAMPLES.filter(
    ({ seasonYear }) => seasonYear !== null && seasonYear >= 1990 && seasonYear <= 1999,
  )
  const favorites = 'These are fan favorites, not this week’s trending.'
  const fromThe1990s = 'A few fan favorites from the 1990s, not the full list.'
  // What the visitor sees: the trending heading and the intro's button that leads to it, the
  // panels' titles, rank numbers, panels that say "Number 1 trending", the strip's titles and
  // both sections' status lines.
  const shown = `({
    heading: document.getElementById('ab-trending').firstChild.textContent,
    button: document.querySelector('.ab-intro-actions a[href="#ab-trending"]').textContent,
    panels: [...document.querySelectorAll('.ab-grid .ab-caption b')].map((title) => title.textContent),
    ranks: document.querySelectorAll('.ab-grid .ab-rank').length,
    ranked: [...document.querySelectorAll('.ab-grid .ab-caption')].filter((caption) => caption.textContent.includes('trending')).length,
    strip: [...document.querySelectorAll('.ab-strip-row .ab-strip-title')].map((title) => title.textContent),
    notes: ${notes},
  })`
  type Shown = {
    heading: string
    button: string
    panels: string[]
    ranks: number
    ranked: number
    strip: string[]
    notes: string[]
  }
  const samplesShown = (status: string) => ({
    heading: 'Fan favorites',
    // The button must not promise this week's trending either.
    button: 'See fan favorites',
    panels: SAMPLES.slice(0, 9).map(titleOf),
    ranks: 0,
    ranked: 0,
    strip: nineties.map(titleOf),
    notes: [`${favorites} ${status}`, `${fromThe1990s} ${status}`],
  })

  before(async () => {
    await browser.forget()
    await browser.blockAniList()
  })

  test('on a phone, the intro holds its covers’ place while the sample titles load', async () => {
    // Each height the cover band takes, a frame at a time from the start of the page.
    const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__band = []
        requestAnimationFrame(function sample() {
          const height = document.querySelector('.ab-intro-art')?.getBoundingClientRect().height
          if (height !== undefined && window.__band.at(-1) !== Math.round(height))
            window.__band.push(Math.round(height))
          requestAnimationFrame(sample)
        })`,
    })
    try {
      await browser.load({ width: 390, height: 844, phone: true })
      assert.ok(
        await browser.waitFor(`document.querySelectorAll('.ab-intro-art img').length === 3`),
        'the samples’ covers never came',
      )
      const band = await browser.evaluate<number[]>('window.__band')
      // The first try fails at once, and the samples' file loads after it. Collapsing in between,
      // the band would pull the headline up, then push it back down when their covers came.
      assert.ok(
        band.every((height) => height >= band.at(-1)! - 2),
        `the cover band went ${band.join(' → ')}px`,
      )
    } finally {
      await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    }
  })

  // The samples are a file of their own (see fallback.ts), so they can fail to load as well.
  test('on a phone, if the sample titles can’t load either, the intro holds no empty space for covers', async () => {
    await browser.send('Network.enable')
    await browser.send('Network.setBlockedURLs', { urls: ['*samples*'] })
    try {
      await browser.load({ width: 390, height: 844, phone: true })
      assert.ok(
        await browser.waitFor(
          `${notes}.every((note) => note.includes('Trying again in a minute'))`,
          15_000,
        ),
        'the sections never said AniList isn’t responding',
      )
      // The band holds the covers' place until the samples' file fails, which it does at once.
      await browser.waitFor(
        `document.querySelector('.ab-intro-art').getBoundingClientRect().height < 100`,
        5_000,
      )
      const state = await browser.evaluate<{ art: number; hint: string; off: boolean }>(`({
        art: document.querySelector('.ab-intro-art').getBoundingClientRect().height,
        hint: document.querySelector('.ab-hint').textContent,
        off: document.querySelector('.ab-lever').disabled,
      })`)
      // Held for covers that aren't coming, the band pushed the buttons off a small phone's screen.
      assert.ok(state.art < 100, `the intro holds ${Math.round(state.art)}px for covers`)
      // With no titles on the page, the machine says why its lever is off.
      assert.match(state.hint, /fills up with titles once AniList answers/)
      assert.equal(state.off, true, 'the lever is on with nothing to pull')
    } finally {
      await browser.send('Network.setBlockedURLs', { urls: [] })
      await browser.send('Network.disable')
    }
  })

  test('while it retries, each section shows sample titles, says what they are and that it is not the visitor', async () => {
    await browser.load() // still a first visit: an outage saves nothing
    // The samples load once the first try has failed.
    await browser.waitFor(
      `${notes}.every((note) => note.endsWith('Trying again in a minute.')) && document.querySelectorAll('.ab-grid .ab-link').length && document.querySelectorAll('.ab-intro-art img').length`,
      15_000,
    )
    const page = await browser.evaluate<Shown & { covers: number; off: boolean }>(`({
      ...${shown},
      covers: document.querySelectorAll('.ab-intro-art img').length,
      off: document.querySelector('.ab-lever').disabled,
    })`)
    assert.deepEqual(page, {
      ...samplesShown(
        'AniList isn’t responding right now. It’s not something you did. Trying again in a minute.',
      ),
      // The intro's fan and the pull use the samples too.
      covers: 3,
      off: false,
    })
  })

  // They are swapped in as the page renders, never put in the query cache: that is saved for a
  // day, so they would come back on the next visit as AniList's answer, and pass for fresh.
  test('the sample titles are never saved as AniList’s', async () => {
    await sleep(1_500) // the saved copy updates a second after the page's last change
    const saved = await browser.evaluate<string[]>(
      `(JSON.parse(localStorage.getItem('anibeam:cache'))?.clientState.queries ?? []).flatMap((query) => query.state.data ?? []).map((media) => media.title.romaji)`,
    )
    assert.deepEqual(saved, [], 'titles saved while the samples show')
  })

  test('once retrying fails, each section offers Try again over its samples, with no loading panels', async () => {
    assert.ok(
      await browser.waitFor(`document.querySelectorAll('.ab-retry').length === 2`, 150_000),
      'no Try again buttons',
    )
    const page = await browser.evaluate<Shown & { placeholders: number }>(
      `({ ...${shown}, placeholders: document.querySelectorAll('.ab-skeleton, .ab-skeleton-fill').length })`,
    )
    assert.deepEqual(page, {
      ...samplesShown(
        'AniList, where AniBeam gets its anime, isn’t responding right now. It’s not something you did. Try again in a minute.',
      ),
      placeholders: 0,
    })
  })

  test('Try again keeps the samples on screen while it runs', async () => {
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
    // TanStack clears the lists' failure as they try again, and the try waits out anilist()'s
    // pause first.
    assert.deepEqual(
      await browser.evaluate<Shown>(shown),
      samplesShown(
        'Taking a short break from AniList so it isn’t overloaded. It’s not something you did. Trying again within a minute.',
      ),
    )
  })

  test('once AniList answers, every section shows its own titles again', async () => {
    // With the panels on screen: a new order of AniList's titles waits there (see
    // useSteadyList), but the samples give way to AniList's titles at once.
    await browser.evaluate(`document.querySelector('#ab-trending').scrollIntoView(); true`)
    await browser.blockAniList(false)
    // Both lists come in one answer, and the 1990s outnumber their samples.
    assert.ok(
      await browser.waitFor(
        `document.querySelectorAll('.ab-strip-row .ab-strip-panel[href]').length > ${nineties.length}`,
        120_000,
      ),
      'AniList’s titles did not come back',
    )
    await browser.waitFor(
      `document.querySelectorAll('.ab-grid .ab-rank').length === 9 && ${notes}.join('') === ''`,
      5_000,
    )
    const page = await browser.evaluate<Shown>(shown)
    assert.deepEqual(
      {
        heading: page.heading,
        button: page.button,
        ranks: page.ranks,
        ranked: page.ranked,
        notes: page.notes,
      },
      {
        heading: 'Trending now',
        button: 'See what’s trending',
        ranks: 9,
        ranked: 9,
        notes: ['', ''],
      },
    )
    assert.notDeepEqual(
      page.panels,
      SAMPLES.slice(0, 9).map(titleOf),
      'the samples stayed on screen once AniList answered',
    )
  })
})
