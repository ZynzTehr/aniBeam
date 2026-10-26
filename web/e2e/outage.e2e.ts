// A visitor while AniList is unreachable: a returning visitor keeps last visit's titles, and a
// first-time visitor gets sample titles with friendly messages, then Try again. After a failed
// connection the AniList client waits a minute before retrying: the checks that wait it out do so
// on a stopped page clock, in a browser of their own.
import { hashKey, type QueryKey } from '@tanstack/react-query'
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { runtimeOf, titleOf } from '../src/features/anime/format.ts'
import {
  eraQuery,
  ERAS,
  FIRST_ERA,
  trendingQuery,
  type Media,
} from '../src/features/anime/queries.ts'
import { SAMPLES } from '../src/features/anime/samples.ts'
import { parseSynopsis } from '../src/features/anime/synopsis.ts'
import { tagsOf } from '../src/features/anime/tags.ts'
import { pullable } from '../src/features/mood/roll.ts'
import { rankMatches } from '../src/features/mood/score.ts'
import { deriveAccent } from '../src/features/theming/deriveAccent.ts'
import { Browser, poll } from './browser.ts'

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

// Counts the page's requests for a decade's mood pool (its two pages, p1 and p2, alone or with the
// decade's page) as they reach fetch, in window.__poolAsked from now on, and gives page script that
// presses each mood slider, as a pointer and as keys do, pulls 3 times if it can, then picks the
// 1980s with a slider set. While anilist() waits out its minute's pause after a failure, every
// request it makes waits too: a count of 0 a second later shows only that nothing went around
// that pause. That none of it asks for a pool once the minute is up is the clock-moved check, 'a
// decade picked with a slider set during the minute ...', below.
const pressEverything = `(async () => {
  window.__poolAsked = 0
  const fetch = window.fetch
  window.fetch = function (url, init) {
    if (String(init?.body ?? '').includes(' p1: ')) window.__poolAsked++
    return fetch.apply(this, arguments)
  }
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  for (const input of document.querySelectorAll('.ab-pull input[type="range"]')) {
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '-2')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await frame()
  }
  for (let i = 0; i < 3; i++) {
    document.querySelector('.ab-lever').click()
    await frame()
  }
  document.querySelector('.ab-eras input[value="1980s"]').click()
  return true
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
      [
        'ab-band',
        'ab-img',
        'ab-intro-cover',
        'ab-match-cover',
        'ab-result-panel',
        'ab-sheet-art',
        'ab-strip-panel',
      ],
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
 * A saved copy as the app writes it under anibeam:cache, with buster v2: each of `lists` as
 * TanStack dehydrates it, saved at `savedAt`. Each list goes under the hash TanStack's hashKey
 * makes of its key, which the page looks it up by: hashKey sorts the variables, so for the 1990s
 * it isn't the key's JSON.
 */
function savedCopy(savedAt: number, lists: [QueryKey, Media[]][]) {
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
// sessionStorage. Yet a visitor back on the same release, from a tab closed earlier that day,
// would lose every title it saved. Here a copy in the format the app saves, under today's queries,
// is in place before the page's own scripts run, so it comes back only through the persister the
// page builds: its key, buster and storage, and main.tsx's wiring. No unit test sees those: none
// loads main.tsx, and those that restore a copy build a persister of their own. Saved a minute
// ago, its lists are fresh, and AniList is kept away, so this asks AniList for none. A change meant
// to drop such a copy, such as a new buster, must change this too. (A copy an earlier release
// saved under other query text is another matter: see the check after this one.)
test('a visitor back on this release sees the titles it saved while AniList is down', async () => {
  // Twenty for trending, as many as AniList sends, and the other ten for the 1990s, the decade
  // the page opens on.
  const trending = renamed(SAMPLES.slice(0, 20), 'Saved trending title')
  const nineties = renamed(SAMPLES.slice(20), 'Saved 1990s title')
  const copy = savedCopy(Date.now() - 60_000, [
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
      'with AniList down, the page did not show the titles it saved',
    )
    assert.equal(asked, 0, 'the page asked AniList for titles it saved')
  } finally {
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    await browser.blockAniList(false)
  }
})

// From 900px wide the splash panel shows its title's banner, and below that its cover, in the
// same img: narrowing the window or turning a tablet swaps one file for the other. A banner that
// failed must not keep the cover hidden once it loads. With AniList kept away, the panels show
// the samples, so the splash title has a banner whatever is trending, and no recording is needed.
// The last release's queries for trending and a decade, as it sent them before the lists carried
// each title's trailer (main at 7983f83), written out rather than built from today's, which ask
// for the trailer too: everything it saved, it saved under this text and these variables.
const LAST_CARD = `id title { romaji english native } coverImage { extraLarge large color } bannerImage
  genres averageScore format episodes season seasonYear studios(isMain: true) { nodes { name } }
  nextAiringEpisode { episode airingAt } description(asHtml: false) duration
  tags { name rank isAdult isGeneralSpoiler isMediaSpoiler }`
const LAST_SAFE = 'isAdult: false, genre_not_in: ["Hentai"]'
const LAST_TRENDING = `query { Page(perPage: 20) { media(type: ANIME, sort: TRENDING_DESC, countryOfOrigin: "JP", ${LAST_SAFE}) { ${LAST_CARD} } } }`
const LAST_ERA = `query ($from: FuzzyDateInt, $to: FuzzyDateInt, $status: MediaStatus, $notStatus: MediaStatus) { Page(perPage: 20) { media(type: ANIME, sort: POPULARITY_DESC, countryOfOrigin: "JP", startDate_greater: $from, startDate_lesser: $to, status: $status, status_not: $notStatus, ${LAST_SAFE}) { ${LAST_CARD} } } }`
const LAST_NINETIES = { from: 19899999, to: 20000000, notStatus: 'NOT_YET_RELEASED' }

// Each answer is saved under its query's exact text, so a change to a query (here, the trailer
// added to every list's) leaves what the release before it saved where nothing looks it up, and
// the saved copy brings it back no more (see restored in lib/queryClient.ts). A visitor back from
// that release, within the day its lists are kept, loses them once: AniList is asked again, and
// while it is down, the samples show, as on a first visit. That is the cost of never showing an
// answer to an older query as today's; a change that brought such a copy back as today's lists
// fails here, and one that changes the lists' query again must write out this text anew.
test('a visitor back from the release before the trailer, its lists saved under that release’s queries, sees the samples while AniList is down', async () => {
  const trending = renamed(SAMPLES.slice(0, 20), 'Saved trending title')
  const nineties = renamed(SAMPLES.slice(20), 'Saved 1990s title')
  const copy = savedCopy(Date.now() - 60_000, [
    [['anilist', LAST_TRENDING, {}], trending],
    [['anilist', LAST_ERA, LAST_NINETIES], nineties],
  ])
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('anibeam:cache', ${JSON.stringify(copy)})`,
  })
  await browser.blockAniList()
  try {
    await browser.load()
    // The samples load once the first try has failed; the saved titles, had they come back, at
    // once.
    assert.ok(await browser.titlesShown(15_000), 'neither the saved titles nor the samples came')
    const page = await browser.evaluate<Shown>(shown)
    const samples1990s = SAMPLES.filter(
      ({ seasonYear }) => seasonYear !== null && seasonYear >= 1990 && seasonYear <= 1999,
    )
    assert.deepEqual(
      { heading: page.heading, panels: page.panels, strip: page.strip },
      {
        heading: 'Fan favorites',
        panels: SAMPLES.slice(0, 9).map(titleOf),
        strip: samples1990s.map(titleOf),
      },
      'the lists the release before saved came back as today’s',
    )
  } finally {
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    await browser.blockAniList(false)
    await browser.forget()
  }
})

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
      // And nothing pressed on it sends a pool request around anilist()'s pause (see
      // pressEverything): past the decade's 300 ms wait, nothing has reached fetch.
      await browser.evaluate(pressEverything)
      await sleep(1_000)
      assert.equal(
        await browser.evaluate('window.__poolAsked'),
        0,
        'a pool request went around the minute’s pause',
      )
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

  test('while it retries, each section shows sample titles, says what they are and that it is not the visitor, and the machine ranks them, saying so', async () => {
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
    // A slider set ranks the samples, and the machine's line says what it pulls from.
    const sliders = { energy: -2, tone: 0, complexity: 0 } as const
    const matches = rankMatches(pullable(nineties), sliders)
      .slice(0, 3)
      .map((media) => `/anime/${media.id}`)
    await browser.evaluate(`(() => {
      const input = document.querySelector('.ab-pull input[type="range"]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '-2')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    const ranked = `[...document.querySelectorAll('.ab-pull .ab-match[href]')].map((link) => link.getAttribute('href'))`
    await browser.waitFor(`${ranked}.join() === ${JSON.stringify(matches.join())}`, 5_000)
    assert.deepEqual(
      await browser.evaluate(
        `({ line: document.querySelector('.ab-pull .ab-set').textContent, matches: ${ranked} })`,
      ),
      {
        line: `AniList can’t be reached. Pulling from ${pullable(nineties).length} sample titles.`,
        matches,
      },
      'the machine with a slider set over the samples',
    )
    // Nothing pressed on the machine sends a pool request around anilist()'s pause (see
    // pressEverything): past the decade's 300 ms wait, nothing has reached fetch.
    await browser.evaluate(pressEverything)
    await sleep(1_000)
    assert.equal(
      await browser.evaluate('window.__poolAsked'),
      0,
      'a pool request went around the minute’s pause',
    )
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

  // The rest wait out anilist()'s minute after a failed connection, and the wait AniList's 429
  // asks for, on the page's own clock, stopped and moved on by the check (see Browser.stopClock):
  // on a real clock, each of the two that wait a minute took a minute of the run. A stopped clock
  // can't start again, so they share a browser of their own: a first visit again, with AniList
  // blocked. The page's every request to AniList is noted in window.__asked as it goes, with when
  // it went and when its answer or failure came, by Date.now(), which anilist() times its pauses
  // by, and which the stopped clock moves only as the check ticks it on, and with the decade it
  // asks for (its variables' from, if any) and whether it asks for a mood pool too.
  describe('on a clock the check moves', () => {
    let own: Browser
    type Asked = {
      sent: number
      settled?: number
      status?: number | 'failed'
      from?: number
      pool: boolean
    }
    const noteAsked = `(() => {
      const fetch = window.fetch
      window.__asked = []
      window.fetch = function (url, init) {
        if (url !== 'https://graphql.anilist.co') return fetch.apply(this, arguments)
        const body = String(init?.body ?? '')
        const from = JSON.parse(body || '{}').variables?.from
        const asked = { sent: Date.now(), from, pool: body.includes(' p1: ') }
        window.__asked.push(asked)
        return fetch.apply(this, arguments).then(
          (response) => Object.assign(asked, { settled: Date.now(), status: response.status }) && response,
          (error) => { Object.assign(asked, { settled: Date.now(), status: 'failed' }); throw error },
        )
      }
    })()`
    const asked = (page = own) => page.evaluate<Asked[]>('window.__asked')
    // The first try has failed, the samples show, and the page waits out the minute.
    const retrying = `${notes}.every((note) => note.endsWith('Trying again in a minute.')) && document.querySelectorAll('.ab-grid .ab-link').length && document.querySelectorAll('.ab-intro-art img').length`

    /**
     * Moves the stopped clock (`page`'s, this group's browser's if not given) on to `ms` past
     * `from`, a moment by the page's Date.now().
     */
    const tickTo = async (from: number, ms: number, page = own) => {
      const now = await page.evaluate<number>('Date.now()')
      if (from + ms <= now)
        throw new Error(`The page's clock is ${now - from - ms} ms past where the check moves it`)
      await page.tick(from + ms - now)
    }

    /**
     * Ticks the stopped clock on 10 ms at a time until `expression` holds, for up to 5 s (200 ms
     * on the page's clock). An answer or a failure comes on Node's clock, and the page takes it
     * in only during a tick (see Browser.stopClock).
     */
    const settles = (expression: string, page = own) =>
      poll(async () => {
        await page.tick(10)
        return page.evaluate<boolean>(`Boolean(${expression})`)
      }, 5_000)

    // Each of the two that wait a minute must take seconds, the minute being the page's alone.
    const quick = (started: number) => {
      const took = Math.round((performance.now() - started) / 1000)
      assert.ok(took < 15, `the check took ${took} s, over 15 s`)
    }

    before(async () => {
      own = await Browser.open()
      await own.blockAniList()
      await own.send('Page.addScriptToEvaluateOnNewDocument', { source: noteAsked })
      await own.load()
      assert.ok(await own.waitFor(retrying, 15_000), 'the samples never showed, retrying')
      await own.animationsDone()
      await own.stopClock()
    })
    after(() => own?.close())

    test('once retrying fails, each section offers Try again over its samples, with no loading panels, and nothing pressed on the machine meanwhile asks for a mood pool', async () => {
      const started = performance.now()
      // Each mood slider pressed and set, as a pointer and a key do, and 3 pulls, while the page
      // waits out anilist()'s minute: a pool asked for now would wait for the minute too, and go
      // with the retry, a third request.
      await own.evaluate(`(() => {
        for (const input of document.querySelectorAll('.ab-pull input[type="range"]')) {
          input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '-2')
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
        for (let i = 0; i < 3; i++) document.querySelector('.ab-lever').click()
        return true
      })()`)
      assert.ok(
        await settles(
          `document.querySelector('.ab-pull .ab-slider-value').textContent === 'Very cozy'`,
        ),
        'the sliders did not move',
      )
      const [failed] = await asked()
      // A second short of a minute after the first try failed, the page still waits.
      await tickTo(failed.settled!, 59_000)
      assert.deepEqual(
        await own.evaluate(
          `({ asked: window.__asked.length, retry: document.querySelectorAll('.ab-retry').length })`,
        ),
        { asked: 1, retry: 0 },
        'within a minute of the first try failing, the page asked AniList again or gave up',
      )
      await tickTo(failed.settled!, 61_000)
      assert.ok(
        await settles(`document.querySelectorAll('.ab-retry').length === 2`),
        'no Try again buttons',
      )
      const tries = await asked()
      assert.equal(tries.length, 2, 'the page tried AniList more than twice')
      // Its one retry went as the minute after the first failure ended, by the page's Date.now().
      const waited = tries[1].sent - failed.settled!
      assert.ok(
        waited >= 60_000 && waited <= 60_050,
        `the page tried again ${waited} ms after the first try failed, not a minute`,
      )
      const page = await own.evaluate<Shown & { placeholders: number }>(
        `({ ...${shown}, placeholders: document.querySelectorAll('.ab-skeleton, .ab-skeleton-fill').length })`,
      )
      assert.deepEqual(page, {
        ...samplesShown(
          'AniList, where AniBeam gets its anime, isn’t responding right now. It’s not something you did. Try again in a minute.',
        ),
        placeholders: 0,
      })
      quick(started)
    })

    test('Try again keeps the samples on screen while it runs', async () => {
      // Press it from the keyboard: the button disappears while retrying, so focus must land
      // somewhere useful (the section's heading), not fall back to the top of the page.
      await own.evaluate(`document.querySelector('.ab-page .ab-retry').focus(); true`)
      await own.press('Enter')
      // Focus moves as the button goes, once the page has re-rendered.
      const landed = await settles(`document.activeElement.id === 'ab-trending'`)
      const focus = await own.evaluate<string>(
        `document.activeElement.id || document.activeElement.tagName`,
      )
      assert.ok(landed, `focus went to ${focus}, not the section's heading`)
      // TanStack clears the lists' failure as they try again, and the try waits out anilist()'s
      // pause first.
      assert.deepEqual(
        await own.evaluate<Shown>(shown),
        samplesShown(
          'Taking a short break from AniList so it isn’t overloaded. It’s not something you did. Trying again within a minute.',
        ),
      )
    })

    test('once AniList answers, every section shows its own titles again', async () => {
      const started = performance.now()
      // Try again's try goes a minute after the retry failed.
      const back = (await asked())[1].settled! + 60_000
      // With the panels on screen: a new order of AniList's titles waits there (see
      // useSteadyList), but the samples give way to AniList's titles at once.
      await own.evaluate(`document.querySelector('#ab-trending').scrollIntoView(); true`)
      // AniList answers 429 twice first, its X-RateLimit-Reset in whole seconds on its clock,
      // which the page reads against its own Date.now() (see retryAt): 30 s on, which the page
      // waits for, and then 90 s on, past AniList's own minute, which it doesn't trust, waiting
      // the minute instead.
      const reset = Math.ceil(back / 1000) + 30
      let busy = 0
      await own.rewriteAniList(() =>
        ++busy > 2
          ? null
          : {
              status: 429,
              body: { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] },
              headers: { 'X-RateLimit-Reset': String(busy === 1 ? reset : reset + 90) },
            },
      )
      await own.blockAniList(false)
      try {
        await tickTo(back, 1_000)
        assert.ok(await settles(`window.__asked[2]?.settled`), 'Try again’s try never went')
        await tickTo(reset * 1000, -500)
        assert.equal((await asked()).length, 3, 'the page asked AniList before its reset time')
        // The page spreads its try over 2 s past the reset (see retryAt).
        await tickTo(reset * 1000, 2_500)
        assert.ok(
          await settles(`window.__asked[3]?.settled`),
          'the page didn’t ask AniList again by its reset time',
        )
        const second = (await asked())[3]
        assert.ok(
          second.sent >= reset * 1000 && second.sent <= reset * 1000 + 2_050,
          `the page asked AniList again ${second.sent - reset * 1000} ms after its reset time, not within 2 s`,
        )
        await tickTo(second.settled!, 59_000)
        assert.equal((await asked()).length, 4, 'the page asked AniList again within a minute')
        await tickTo(second.settled!, 61_000)
        assert.ok(
          await settles(`window.__asked[4]`),
          'told to wait 90 s, past AniList’s own minute, the page didn’t ask again a minute on',
        )
        const waited = (await asked())[4].sent - second.settled!
        assert.ok(
          waited >= 60_000 && waited <= 60_050,
          `told to wait 90 s, the page asked AniList again ${waited} ms on, not a minute`,
        )
        // Both lists come in one answer, and the 1990s outnumber their samples.
        assert.ok(
          await settles(
            `document.querySelectorAll('.ab-strip-row .ab-strip-panel[href]').length > ${nineties.length}`,
          ),
          'AniList’s titles did not come back',
        )
      } finally {
        await own.rewriteAniList(null)
      }
      await settles(
        `document.querySelectorAll('.ab-grid .ab-rank').length === 9 && ${notes}.join('') === ''`,
      )
      const page = await own.evaluate<Shown>(shown)
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
      quick(started)
    })

    // A decade picked with a slider set while anilist() waits out its minute asks for its titles,
    // and that request waits for the minute too: it must go for the decade's page alone, never with
    // its mood pool (PullMachine's outage guard). Its request goes only once the minute is up, so
    // this check moves a stopped clock past it, in a browser of its own: this group's is past its
    // outage by now.
    test('a decade picked with a slider set during the minute asks AniList for its titles alone once the minute is up, not its mood pool', async () => {
      const eighties = ERAS.find((era) => era.id === '1980s')!
      const apart = await Browser.open()
      try {
        await apart.blockAniList()
        await apart.send('Page.addScriptToEvaluateOnNewDocument', { source: noteAsked })
        await apart.load()
        assert.ok(await apart.waitFor(retrying, 15_000), 'the samples never showed, retrying')
        await apart.animationsDone()
        await apart.stopClock()
        const started = performance.now()
        // Energy pressed and set, as a pointer does, then the 1980s picked.
        await apart.evaluate(`(() => {
          const input = document.querySelector('.ab-pull input[type="range"]')
          input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '-2')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          document.querySelector('.ab-eras input[value="1980s"]').click()
          return true
        })()`)
        assert.ok(
          await settles(
            `document.querySelector('.ab-eras input[value="1980s"]').checked && document.querySelector('.ab-pull input[type="range"]').value === '-2'`,
            apart,
          ),
          'the slider did not move, or the 1980s were not picked',
        )
        const [failed] = await asked(apart)
        await tickTo(failed.settled!, 61_000, apart)
        assert.ok(
          await settles(
            `window.__asked.some((asked) => asked.from === ${eighties.variables.from} && asked.settled)`,
            apart,
          ),
          'the page never asked AniList for the 1980s once the minute was up',
        )
        const tries = await asked(apart)
        assert.deepEqual(
          tries.filter((asked) => asked.pool).map((asked) => asked.from),
          [],
          'with AniList down, the page asked it for a decade’s mood pool (by its from)',
        )
        quick(started)
      } finally {
        await apart.close()
      }
    })
  })
})
