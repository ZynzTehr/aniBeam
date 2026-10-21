// A visitor while AniList is unreachable: a returning visitor keeps last visit's titles, and a
// first-time visitor gets sample titles with friendly messages, then Try again. Slow on purpose:
// after a failed connection the AniList client waits a minute before retrying.
import { hashKey, type QueryKey } from '@tanstack/react-query'
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { runtimeOf, titleOf } from '../src/features/anime/format.ts'
import { eraQuery, FIRST_ERA, trendingQuery, type Media } from '../src/features/anime/queries.ts'
import { SAMPLES } from '../src/features/anime/samples.ts'
import { parseSynopsis } from '../src/features/anime/synopsis.ts'
import { tagsOf } from '../src/features/anime/tags.ts'
import { deriveAccent } from '../src/features/theming/deriveAccent.ts'
import { Browser } from './browser.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open() // a fresh profile: nothing saved, like a first visit
})
after(() => browser?.close())

const notes = `[...document.querySelectorAll('.ab-note')].map((note) => note.textContent)`
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

// Counts the page's requests to AniList in window.__asked, from the next load on (added before
// it with Page.addScriptToEvaluateOnNewDocument).
const countRequests = `(() => {
  const fetch = window.fetch
  window.__asked = 0
  window.fetch = function (url) {
    if (url === 'https://graphql.anilist.co') window.__asked++
    return fetch.apply(this, arguments)
  }
})()`

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
// stop it). The titles come from the copy the check above saved, so this needs no recording of
// its own.
test('covers that can’t load show no broken-image icon, and each panel shows its title’s color instead, darkened so its rank stands out', async () => {
  await sleep(1_500) // the saved copy updates within a second of the page's last change
  await browser.send('Network.enable')
  await browser.send('Network.setBlockedURLs', { urls: ['*s4.anilist.co*'] })
  try {
    await browser.load()
    assert.ok(await browser.titlesShown(), 'the titles never came')
    // Lazy covers are asked for as they near the screen. A pull adds one, and a title card its
    // cover and its banner: the first trending title, opened here, is recorded with one.
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
      ['ab-band', 'ab-img', 'ab-intro-cover', 'ab-result-panel', 'ab-sheet-art', 'ab-strip-panel'],
      'places where no cover or banner failed to load, so they went unchecked',
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
// again, so this needs no recording of its own.
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

// Phase 1's "done when": a reload with AniList blocked still shows saved results. The page saves
// AniList's answers (see queryClient.ts), so a returning visitor sees last visit's titles, not the
// samples a first visit gets, without the page asking AniList for them. The last visit loads the
// copy the first check saved, so this needs no recording of its own; run alone, the last visit is
// a first visit, answered from the same recording as the first check's.
test('a returning visitor sees last visit’s titles while AniList is down, not the samples', async () => {
  await browser.load() // the last visit
  assert.ok(await browser.titlesShown(), 'the titles never came')
  const last = await browser.evaluate<Shown>(shown)
  assert.equal(
    last.heading,
    'Trending now',
    'AniList’s titles never came, so there is nothing to check',
  )
  await sleep(1_500) // the saved copy updates within a second of the page's last change
  // From the next load on, counts the page's requests to AniList.
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: countRequests,
  })
  await browser.blockAniList()
  try {
    await browser.load()
    // Without saved titles, the samples would show once the first try had failed.
    assert.ok(await browser.titlesShown(15_000), 'no titles came, not even the samples')
    const { asked, ...page } = await browser.evaluate<Shown & { asked: number }>(
      `({ ...${shown}, asked: window.__asked })`,
    )
    assert.deepEqual(page, last, 'with AniList down, the page did not show last visit’s titles')
    assert.equal(asked, 0, 'the page asked AniList for titles it had saved')
  } finally {
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    await browser.blockAniList(false)
  }
})

/**
 * The JSON the last release saved under anibeam:cache, with buster v2: each of `lists` as TanStack
 * dehydrates it, saved at `savedAt`. Each list goes under the hash TanStack's hashKey makes of its
 * key, which the page looks it up by: hashKey sorts the variables, so for the 1990s it isn't the
 * key's JSON.
 */
function lastReleaseCopy(savedAt: number, lists: [QueryKey, Media[]][]) {
  return JSON.stringify({
    buster: 'v2',
    timestamp: savedAt,
    clientState: {
      mutations: [],
      queries: lists.map(([queryKey, data]) => ({
        dehydratedAt: savedAt,
        state: {
          data,
          dataUpdateCount: 1,
          dataUpdatedAt: savedAt,
          error: null,
          errorUpdateCount: 0,
          errorUpdatedAt: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          fetchMeta: null,
          isInvalidated: false,
          status: 'success',
          fetchStatus: 'idle',
        },
        queryKey,
        queryHash: hashKey(queryKey),
      })),
    },
  })
}

// Titles the bundled samples don't have, so the samples can't pass for them: the samples, renamed.
const renamed = (titles: Media[], name: string): Media[] =>
  titles.map((media, i) => ({
    ...media,
    title: { romaji: `${name} ${i + 1}`, english: null, native: null },
  }))

// The check above saves the copy and reads it back with one build, so a change that build makes
// to both sides passes it: main.tsx giving the provider another buster, say, or the copy kept in
// sessionStorage. Yet a visitor back from the last release would lose every title it saved. Here
// that release's copy is in place before the page's own scripts run, so it comes back only
// through the persister the page builds: its key, buster and storage, and main.tsx's wiring. No
// unit test sees those: none loads main.tsx, and those that restore a copy build a persister of
// their own. Saved a minute ago, its lists are fresh, and AniList is kept away, so this asks
// AniList for none. A change meant to drop that copy, such as a new buster, must change this too.
test('a visitor back from the last release sees the titles it saved while AniList is down', async () => {
  // Twenty for trending, as many as AniList sends, and the other ten for the 1990s, the decade
  // the page opens on.
  const trending = renamed(SAMPLES.slice(0, 20), 'Saved trending title')
  const nineties = renamed(SAMPLES.slice(20), 'Saved 1990s title')
  const copy = lastReleaseCopy(Date.now() - 60_000, [
    [trendingQuery().queryKey, trending],
    [eraQuery(FIRST_ERA).queryKey, nineties],
  ])
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `${countRequests}
      localStorage.setItem('anibeam:cache', ${JSON.stringify(copy)})`,
  })
  await browser.blockAniList()
  try {
    await browser.load()
    // Without the saved titles, the samples would show once the first try had failed.
    assert.ok(await browser.titlesShown(15_000), 'no titles came, not even the samples')
    const { asked, ...page } = await browser.evaluate<Shown & { asked: number }>(
      `({ ...${shown}, asked: window.__asked })`,
    )
    assert.deepEqual(
      page,
      {
        heading: 'Trending now',
        button: 'See what’s trending',
        panels: trending.slice(0, 9).map(titleOf),
        ranks: 9,
        ranked: 9,
        strip: nineties.map(titleOf),
        notes: ['', ''],
      },
      'with AniList down, the page did not show the titles the last release saved',
    )
    assert.equal(asked, 0, 'the page asked AniList for titles the last release saved')
  } finally {
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    await browser.blockAniList(false)
  }
})

// From 900px wide the splash panel shows its title's banner, and below that its cover, in the
// same img: narrowing the window or turning a tablet swaps one file for the other. A banner that
// failed must not keep the cover hidden once it loads. With AniList kept away, the panels show
// the samples, so the splash title has a banner whatever is trending, and no recording is needed.
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

// The samples carry each title's details as a list's titles do (see cardOf), so a sample's card
// shows its synopsis, running time and tags at once while AniList is down, asking it for nothing.
// samples.test.ts checks the data; this, that the card gets it: a sample path that rebuilt the
// titles without their details would leave the card saying "Description unavailable." with every
// unit test passing. The first sample is opened from Fan favorites, on a first visit with AniList
// kept away, so no recording is needed.
test('a sample’s card shows its synopsis, running time and tags while AniList is down, asking it for nothing', async () => {
  const sample = SAMPLES[0]!
  const { paragraphs, source } = parseSynopsis(sample.description)
  const expected = {
    id: sample.id,
    text: paragraphs.map((lines) =>
      lines.map((runs) => runs.map((run) => run.text).join('')).join('\n'),
    ),
    source: source && `Source: ${source}`,
    runtime: runtimeOf(sample)?.text ?? null,
    chips: tagsOf(sample.tags).shown.map(
      (tag) => `${tag.name}${tag.rank === null ? '' : ` ${tag.rank}%`}`,
    ),
    asked: 0,
  }
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: countRequests,
  })
  await browser.blockAniList()
  const seen: string[] = []
  try {
    for (const screen of [
      { width: 390, height: 844, phone: true },
      { width: 1440, height: 900 },
    ]) {
      await browser.forget()
      await browser.load({ ...screen, reduceMotion: true })
      assert.ok(
        await browser.waitFor(
          `document.getElementById('ab-trending').firstChild.textContent === 'Fan favorites' && document.querySelector('.ab-grid .ab-link')`,
          15_000,
        ),
        `at ${screen.width}px, the samples never showed`,
      )
      // Requests from the click on: the lists' next try is a minute away.
      await browser.evaluate(`(() => {
        window.__asked = 0
        document.querySelector('.ab-grid .ab-link').click()
        return true
      })()`)
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card[open] .ab-details')`),
        `at ${screen.width}px, no card opened`,
      )
      await browser.animationsDone()
      const shown = await browser.evaluate(`(() => {
        const card = document.querySelector('dialog.ab-card[open]')
        const text = card.querySelector('.ab-synopsis-text')
        const fact = [...card.querySelectorAll('.ab-facts > div')].find((fact) => fact.querySelector('dt').textContent === 'Runtime')
        return {
          id: Number(document.querySelector('.ab-grid .ab-link').getAttribute('href').split('/').pop()),
          text: text ? [...text.querySelectorAll('p')].map((p) => p.innerText) : card.querySelector('.ab-synopsis-none')?.textContent ?? 'none',
          source: card.querySelector('.ab-source')?.textContent ?? null,
          runtime: fact?.querySelector('dd [aria-hidden="true"]')?.textContent ?? null,
          chips: [...card.querySelectorAll('.ab-tags li')].map((chip) => chip.textContent),
          asked: window.__asked,
        }
      })()`)
      if (JSON.stringify(shown) !== JSON.stringify(expected))
        seen.push(`${screen.width}px: ${JSON.stringify(shown)}`)
    }
  } finally {
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    await browser.blockAniList(false)
  }
  assert.deepEqual(
    seen,
    [],
    `sample cards without their details, or asking for them, not ${JSON.stringify(expected)}`,
  )
})

// Spec §3H: a section that can't reach AniList shows bundled sample titles instead of an empty
// page, and says what they are. Trending shows the first 9; the decade strip, the open decade's.
describe('AniList down on a first visit', () => {
  const nineties = SAMPLES.filter(
    ({ seasonYear }) => seasonYear !== null && seasonYear >= 1990 && seasonYear <= 1999,
  )
  const favorites = 'These are fan favorites, not this week’s trending.'
  const fromThe1990s = 'A few fan favorites from the 1990s, not the full list.'
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

  // A browser can block a site's storage altogether ("block all site data"): reading localStorage
  // or sessionStorage then throws, and the page must still work, just without a saved copy.
  // storage.test.ts checks that for queryClient.ts alone, and in Node: storage read anywhere else
  // as the page loads, such as main.tsx clearing an old copy, would throw in such a browser and
  // leave the page blank, yet pass every unit test. Here the whole page loads in Chrome with its
  // storage blocked. Nothing can be restored, so it is a first visit like the rest of this
  // group's, with AniList kept away: the samples show, and no recording is needed.
  test('when the browser blocks storage, the page still loads, shows the sample titles and throws nothing', async () => {
    // What Chrome does when site data is blocked: reading either storage throws a SecurityError.
    const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `for (const name of ['localStorage', 'sessionStorage'])
        Object.defineProperty(window, name, {
          configurable: true,
          get() {
            throw new DOMException("Failed to read the '" + name + "' property from 'Window': Access is denied for this document.", 'SecurityError')
          },
        })`,
    })
    // The checks above may have left problems of their own: only this load's count here.
    const earlier = browser.problems.length
    try {
      await browser.load()
      const titles = await browser.titlesShown(15_000)
      const storage = await browser.evaluate<string[]>(
        `['localStorage', 'sessionStorage'].map((name) => { try { return typeof window[name] } catch (error) { return error.name } })`,
      )
      assert.deepEqual(
        storage,
        ['SecurityError', 'SecurityError'],
        'the page could read its storage, so there is nothing to check',
      )
      assert.deepEqual(
        browser.problems.slice(earlier).filter((problem) => problem.startsWith('exception')),
        [],
        'with storage blocked, the page threw',
      )
      assert.ok(titles, 'with storage blocked, no titles came, not even the samples')
      const page = await browser.evaluate<Shown>(shown)
      assert.deepEqual(
        { panels: page.panels, strip: page.strip },
        { panels: SAMPLES.slice(0, 9).map(titleOf), strip: nineties.map(titleOf) },
        'with storage blocked, the page did not show the sample titles',
      )
    } finally {
      await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
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
    await sleep(1_500) // the saved copy updates within a second of the page's last change
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
