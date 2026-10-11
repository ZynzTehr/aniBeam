// A returning visitor's lists, refreshed while they are on screen: trending's titles (spec §3H: a
// visible list is never re-sorted when a background refresh arrives), and the decade row, which a
// refresh never sends back to Ch.1. Its own file, so the aged lists and the reordered answers stay
// in a profile of their own. About 4 AniList requests: the first visit, then one refresh in each
// check but the last, which answers its own inside the page.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { hasSmallCover } from '../src/features/anime/format.ts'
import type { Media } from '../src/features/anime/queries.ts'
import { Browser } from './browser.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open() // a fresh profile: the first load is a first visit
  await browser.load()
  assert.ok(await browser.titlesShown(), 'trending and decade titles never appeared')
})
after(() => browser?.close())

// The trending titles the page saved (see queryClient.ts), and what it shows of them: the panels'
// ids and the intro's covers.
const saved = `JSON.parse(localStorage.getItem('anibeam:cache')).clientState.queries.find((query) => query.queryKey[1].includes('TRENDING_DESC')).state.data`
const panels = `[...document.querySelectorAll('.ab-grid .ab-link')].map((link) => Number(link.hash.replace('#title-', '')))`
const covers = `[...document.querySelectorAll('.ab-intro-art img')].map((img) => img.getAttribute('src'))`
// What should show of a list: its first nine titles, and the intro's cover fan, which is the first
// three big covers (see IntroHero).
const nine = (titles: Media[]) => titles.slice(0, 9).map((media) => media.id)
const fan = (titles: Media[]) =>
  titles
    .filter((media) => !hasSmallCover(media))
    .slice(0, 3)
    .map((media) => media.coverImage.extraLarge)
// Whether part of an element shows between the header and the bottom of the screen.
const inView = (selector: string) =>
  `(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return r.bottom > document.querySelector('.ab-top').getBoundingClientRect().bottom && r.top < innerHeight })()`
// The 1990s the page saved: the decade it opens on, and the only one this file shows. Their row
// in the decade strip, and the ids of the titles in it, in order.
const savedDecade = `JSON.parse(localStorage.getItem('anibeam:cache')).clientState.queries.find((query) => query.queryKey[1].includes('POPULARITY_DESC')).state.data`
const decadeRow = `document.querySelector('[aria-labelledby="decades"] .ab-strip-row:not([aria-hidden])')`
const decadePanels = `[...${decadeRow}.querySelectorAll('.ab-strip-panel')].map((link) => Number(link.hash.replace('#title-', '')))`

/**
 * Comes back as a visitor would an hour later: trending goes out of date after 30 minutes, so
 * the page shows the saved titles and asks AniList for new ones. The answer brings the saved
 * titles in reverse order, and is held 3 seconds so the check can look first. Returns the saved
 * titles and the new order.
 */
async function returnAnHourLater() {
  await sleep(1_500) // the saved copy updates a second after the page's last change
  const titles = await browser.evaluate<Media[]>(`(() => {
    const cache = JSON.parse(localStorage.getItem('anibeam:cache'))
    for (const query of cache.clientState.queries) query.state.dataUpdatedAt -= 60 * 60 * 1000
    localStorage.setItem('anibeam:cache', JSON.stringify(cache))
    return ${saved}
  })()`)
  const refreshed = titles.toReversed()
  // A refresh's answer has its titles in data.Page; a first visit's, in data.trending.
  await browser.rewriteAniList(({ request, status, body }) => {
    if (status !== 200 || !request.query.includes('TRENDING_DESC')) return null
    const list = body.data.trending ? 'trending' : 'Page'
    return { status, body: { data: { ...body.data, [list]: { media: refreshed } } } }
  })
  await browser.holdAniList(3_000)
  await browser.load()
  return { titles, refreshed }
}

/**
 * Resolves once the page has saved the new order of trending (or of `list`), a second after the
 * refresh landed.
 */
const landed = (refreshed: Media[], list = saved) =>
  browser.waitFor(
    `${list}.map((media) => media.id).join() === '${refreshed.map((media) => media.id).join()}'`,
    15_000,
  )

test('a new trending order waits while the panels are on screen, and shows once they are scrolled away', async () => {
  try {
    const { titles, refreshed } = await returnAnHourLater()
    await browser.waitFor(`${panels}.length === 9`, 5_000)
    await browser.evaluate(`document.querySelector('#ab-trending').scrollIntoView(); true`)
    const before = await browser.evaluate<number[]>(panels)
    assert.deepEqual(before, nine(titles), 'the new order came before the check could look')
    assert.ok(await landed(refreshed), 'the refresh never landed')
    const after = await browser.evaluate<number[]>(panels)
    const looking = await browser.evaluate<boolean>(inView('.ab-grid'))
    // At the top of the page the panels are out of sight, below the intro.
    await browser.evaluate(`scrollTo(0, 0); true`)
    const away = await browser.waitFor(`${panels}.join() === '${nine(refreshed).join()}'`, 5_000)
    await browser.evaluate(`document.querySelector('#ab-trending').scrollIntoView(); true`)
    const back = await browser.evaluate<number[]>(panels)
    assert.ok(looking, 'the panels were not on screen when the refresh landed')
    assert.deepEqual(after, before, 'the panels took the new order while on screen')
    assert.ok(away, 'the new order did not come while the panels were out of sight')
    assert.deepEqual(back, nine(refreshed), 'the old order came back with the panels')
  } finally {
    await browser.holdAniList(0)
    await browser.rewriteAniList(null)
  }
})

test('new covers for the intro wait while it is on screen, and show once it is scrolled away', async () => {
  try {
    const { titles, refreshed } = await returnAnHourLater()
    await browser.evaluate(`scrollTo(0, 0); true`)
    await browser.waitFor(`${covers}.length === 3`, 5_000)
    const before = await browser.evaluate<string[]>(covers)
    assert.deepEqual(before, fan(titles), 'the new order came before the check could look')
    assert.ok(await landed(refreshed), 'the refresh never landed')
    const after = await browser.evaluate<string[]>(covers)
    const looking = await browser.evaluate<boolean>(inView('.ab-intro-art'))
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    const away = await browser.waitFor(
      `${covers}.join() === ${JSON.stringify(fan(refreshed).join())}`,
      5_000,
    )
    await browser.evaluate(`scrollTo(0, 0); true`)
    const back = await browser.evaluate<string[]>(covers)
    assert.ok(looking, 'the intro’s covers were not on screen when the refresh landed')
    assert.deepEqual(after, before, 'the intro’s covers changed while on screen')
    assert.ok(away, 'the new covers did not come while the intro was out of sight')
    assert.deepEqual(back, fan(refreshed), 'the old covers came back with the intro')
  } finally {
    await browser.holdAniList(0)
    await browser.rewriteAniList(null)
  }
})

// Where the decade row is: its scrollLeft; the panel with keyboard focus, counted from Ch.1; how
// much of that panel shows inside the row; and whether its focus ring (4px plus a 3px gap) is cut
// off at either end. Read two frames on, once the page has drawn what came before.
type Place = { left: number; panel: number; shown: number; ringCut: boolean }
const place = `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const row = ${decadeRow}, panel = document.activeElement
  const r = row.getBoundingClientRect(), p = panel.getBoundingClientRect()
  const shown = Math.max(0, Math.min(p.right, r.right) - Math.max(p.left, r.left)) / p.width
  resolve({ left: row.scrollLeft, panel: [...row.children].indexOf(panel.parentElement) + 1, shown: Math.round(shown * 100) / 100, ringCut: p.left - 7 < r.left || p.right + 7 > r.right })
})))`

test('a refresh that reorders the decade on screen doesn’t send its row back to Ch.1, away from the focused panel', async () => {
  // A newly picked decade opens at Ch.1 (see Strip). A refresh of the decade on screen used to
  // count as a new one when it changed the titles' order: the row jumped back to Ch.1 while the
  // visitor was using it, taking a panel they had tabbed to out of view, ring and all.
  try {
    // Seven hours on, the saved 1990s are out of date (after 6 hours), so the page shows them and
    // asks AniList again. Only they are aged: trending stays fresh, so the page asks for the 1990s
    // alone. The answer swaps their first two titles, as a shift in popularity would, and is held
    // 3 seconds so the check can use the row first. Both are scrolled out of sight to the left, so
    // the row should not move at all. (Chrome keeps a snapping row on the title at its start, so a
    // refresh that moved that title would take the row with it.)
    await sleep(1_500) // the saved copy updates a second after the page's last change
    const titles = await browser.evaluate<Media[]>(`(() => {
      const cache = JSON.parse(localStorage.getItem('anibeam:cache'))
      for (const query of cache.clientState.queries)
        if (query.queryKey[1].includes('POPULARITY_DESC')) query.state.dataUpdatedAt -= 7 * 60 * 60 * 1000
      localStorage.setItem('anibeam:cache', JSON.stringify(cache))
      return ${savedDecade}
    })()`)
    const [first, second, ...rest] = titles
    const refreshed = [second, first, ...rest]
    await browser.rewriteAniList(({ request, status }) =>
      status === 200 && request.query.includes('POPULARITY_DESC')
        ? { status, body: { data: { Page: { media: refreshed } } } }
        : null,
    )
    await browser.holdAniList(3_000)
    // With reduced motion nothing pops in, so the panels can be measured as soon as they show.
    await browser.load({ reduceMotion: true })
    assert.ok(
      await browser.waitFor(`${decadePanels}.length === ${titles.length}`, 5_000),
      'the saved 1990s did not show',
    )
    // From the chosen decade's chip, Tab to Ch.8: the row scrolls to show it in full.
    await browser.evaluate(
      `${decadeRow}.scrollIntoView({ block: 'center' }); document.querySelector('.ab-eras input:checked').focus(); true`,
    )
    for (let i = 0; i < 8; i++) await browser.press('Tab')
    const before = await browser.evaluate<Place>(place)
    assert.deepEqual(
      await browser.evaluate<number[]>(decadePanels),
      titles.map((media) => media.id),
      'the new order came before the check could look',
    )
    assert.deepEqual(
      { panel: before.panel, shown: before.shown, ringCut: before.ringCut },
      { panel: 8, shown: 1, ringCut: false },
      'Tab did not bring Ch.8 into full view, with its ring',
    )
    assert.ok(before.left > 0, 'the row did not scroll to show Ch.8')
    assert.ok(await landed(refreshed, savedDecade), 'the refresh never landed')
    const after = await browser.evaluate<Place>(place)
    assert.deepEqual(
      after,
      before,
      'the refresh moved the decade row under the visitor (its scrollLeft; the focused panel, how much of it shows, and whether its ring is cut)',
    )
  } finally {
    await browser.holdAniList(0)
    await browser.rewriteAniList(null)
  }
})

// A refresh that brings no titles at all empties trending's panels at once, so their note, "No
// titles found.", never sits over old titles. The intro's covers are only decoration and stay
// (see steadyList): on a phone they sit above the headline, which jumped 77px up when they went.
// AniList rarely sends an empty list, so the refresh is answered inside the page, and no request
// is sent. Last in this file: it leaves trending saved with no titles.
test('on a phone, a trending refresh with no titles empties the panels but keeps the intro’s covers, so the headline stays put', async () => {
  await sleep(1_500) // the saved copy updates a second after the page's last change
  // An hour on, as in returnAnHourLater, but only trending: the 1990s stay fresh, so the page asks
  // for trending alone.
  await browser.evaluate(`(() => {
    const cache = JSON.parse(localStorage.getItem('anibeam:cache'))
    for (const query of cache.clientState.queries)
      if (query.queryKey[1].includes('TRENDING_DESC')) query.state.dataUpdatedAt -= 60 * 60 * 1000
    localStorage.setItem('anibeam:cache', JSON.stringify(cache))
    return true
  })()`)
  // In place before the page loads, since it asks as it opens: trending's refresh gets a list with
  // no titles, once the check lets it go with window.__answer().
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const fetch = window.fetch
      let answer
      const answered = new Promise((resolve) => (answer = resolve))
      window.__answer = () => (answer(), true)
      window.fetch = function (url, init) {
        if (url !== 'https://graphql.anilist.co' || !JSON.parse(init.body).query.includes('TRENDING_DESC'))
          return fetch.apply(this, arguments)
        window.__asked = true
        const empty = JSON.stringify({ data: { Page: { media: [] } } })
        return answered.then(() => new Response(empty, { headers: { 'Content-Type': 'application/json' } }))
      }
    })()`,
  })
  const note = `document.querySelector('[aria-labelledby="ab-trending"] .ab-note').textContent`
  try {
    await browser.load({ width: 390, height: 844, phone: true })
    assert.ok(
      await browser.waitFor(`window.__asked && ${covers}.length === 3 && ${panels}.length === 9`),
      'the saved titles did not show, or the page did not ask for new ones',
    )
    // Once the intro has landed, where the headline is on screen: read at once, since the answer
    // can land before the next frame, then at every frame.
    await browser.animationsDone()
    await browser.evaluate(`(() => {
      const top = () => Math.round(document.querySelector('.ab-intro-title').getBoundingClientRect().top)
      window.__headline = [top()]
      requestAnimationFrame(function sample() {
        if (window.__headline.at(-1) !== top()) window.__headline.push(top())
        requestAnimationFrame(sample)
      })
      return true
    })()`)
    const before = await browser.evaluate<string[]>(covers)
    await browser.evaluate('window.__answer()')
    assert.ok(
      await browser.waitFor(`${note} === 'No titles found.'`, 5_000),
      'the refresh with no titles never landed',
    )
    // Two frames on, so whatever the refresh set off has been drawn.
    const after = await browser.evaluate<{ panels: number; covers: string[]; headline: number[] }>(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() =>
        resolve({ panels: ${panels}.length, covers: ${covers}, headline: window.__headline }))))`,
    )
    assert.equal(after.panels, 0, 'the panels stayed under “No titles found.”')
    const moved = Math.max(...after.headline) - Math.min(...after.headline)
    assert.ok(
      moved <= 2,
      `the headline moved ${moved}px as the refresh landed (${after.headline.join(' → ')}px)`,
    )
    assert.deepEqual(after.covers, before, 'the intro’s covers went with the refresh')
  } finally {
    await browser.evaluate('window.__answer?.()').catch(() => {}) // in case the check stopped first
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
  }
})
