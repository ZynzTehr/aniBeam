// A returning visitor's trending titles, refreshed while they are on screen. Spec §3H: a visible
// list is never re-sorted when a background refresh arrives. Its own file, so the aged lists and
// the reordered answers stay in a profile of their own. About 3 AniList requests: the first
// visit, then one refresh in each check.
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

/** Resolves once the page has saved the new order, a second after the refresh landed. */
const landed = (refreshed: Media[]) =>
  browser.waitFor(
    `${saved}.map((media) => media.id).join() === '${refreshed.map((media) => media.id).join()}'`,
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
