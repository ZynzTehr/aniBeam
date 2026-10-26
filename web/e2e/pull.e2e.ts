// What can come out of the pull machine: never a title on My List, nor one of the last 30 pulled,
// and none at all when no title of the decade may come out of it (spec §3G keeps Ecchi out of the
// pull) or all that may are on My List. The machine holds the decade below it, its 20 titles on
// the page and then its mood pool, which it asks for only when wanted (see PullMachine): these
// checks count those requests. Its own file, so the doctored answers and the saved lists stay in
// a profile of their own.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { cardOf, QUERIES } from '../src/features/anime/queries.ts'
import { NEED_MORE, pullable } from '../src/features/mood/roll.ts'
import { rankMatches, type Sliders } from '../src/features/mood/score.ts'
import { BASE_URL, Browser, poll } from './browser.ts'
import { askedFor, listsOf, recordedPool, recordings } from './recordings.ts'

/** Adds Ecchi to the genres of every title in an AniList answer. */
function tagEcchi(value: any): any {
  if (Array.isArray(value)) return value.map(tagEcchi)
  if (value === null || typeof value !== 'object') return value
  const copy = Object.fromEntries(Object.entries(value).map(([key, v]) => [key, tagEcchi(v)]))
  if (Array.isArray(copy.genres)) copy.genres = [...copy.genres, 'Ecchi']
  return copy
}

let browser: Browser
// What the first load asked AniList for (see askedFor).
const askedFirst: string[] = []
before(async () => {
  browser = await Browser.open()
  await browser.rewriteAniList(({ request, status, body }) => {
    askedFirst.push(askedFor(request))
    return { status, body: tagEcchi(body) }
  })
  await browser.load()
})
after(() => browser?.close())

// Whether a decade's mood pool is in the page's saved copy: it is saved within a second of
// arriving, after the machine has it.
const poolSaved = `(JSON.parse(localStorage.getItem('anibeam:cache'))?.clientState.queries ?? []).some((query) => query.queryKey[1] === ${JSON.stringify(QUERIES.pool)} && query.state.data)`

test('with nothing in the decade it may hand out, the machine asks once for its pool, then its lever is off and it says why, its sliders still working', async () => {
  assert.ok(await browser.titlesShown(), 'no titles on the page')
  // None of the page's titles can come out, so the pool is wanted with no press, once they have
  // landed: here its titles are all Ecchi too.
  assert.ok(await poll(async () => askedFirst.length >= 2, 10_000), 'the pool was never asked for')
  assert.ok(await browser.waitFor(poolSaved), 'the pool never arrived')
  const machine = await browser.evaluate<{ off: boolean; hint: string; capsules: number }>(`({
    off: document.querySelector('.ab-lever').disabled,
    hint: document.querySelector('.ab-hint')?.textContent ?? '',
    capsules: document.querySelectorAll('.ab-capsule').length,
  })`)
  assert.equal(machine.off, true, 'the lever can be pulled, but nothing would come out')
  assert.match(machine.hint, /another decade/)
  assert.equal(machine.capsules, 0, 'the dome shows titles that cannot come out')
  await setSlider('Energy', -2)
  assert.equal(
    await browser.evaluate(
      `document.querySelector('.ab-pull .ab-slider-value').textContent + ', ' + document.querySelector('.ab-lever').disabled`,
    ),
    'Very cozy, true',
    'the slider did not move, or the lever came on',
  )
  await setSlider('Energy', 0)
  assert.deepEqual(askedFirst, ['first visit', 'pool 1990s'], 'what the page asked AniList for')
})

test('the off lever looks off, and never tilts or swings', async () => {
  // The off lever used to look like a working one, and with motion allowed (as here) it tilted
  // on hover and swung on a press that pulls nothing. A working copy of it, put next to it for
  // a moment, shows what it must not look like, whatever the off look is.
  // In the middle of the screen: below the sliders, the lever can be past its foot, where the
  // mouse would hover nothing and the check would show nothing.
  await browser.evaluate(
    `document.querySelector('.ab-lever').scrollIntoView({ block: 'center' }); true`,
  )
  const at = await browser.evaluate<{ x: number; y: number }>(
    `(() => { const r = document.querySelector('.ab-lever').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
  )
  const away = { x: at.x - 200, y: at.y }
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...away })
  await sleep(400)
  type Look = {
    cursor: string
    fill: string
    shadow: string
    opacity: string
    color: string
    border: string
  }
  const lookOf = (lever: string) =>
    `(() => { const s = getComputedStyle(${lever}); return { cursor: s.cursor, fill: s.backgroundColor, shadow: s.boxShadow, opacity: s.opacity, color: s.color, border: s.borderStyle } })()`
  const { cursor, ...off } = await browser.evaluate<Look>(
    lookOf(`document.querySelector('.ab-lever')`),
  )
  const { cursor: workingCursor, ...working } = await browser.evaluate<Look>(`(() => {
    const lever = document.querySelector('.ab-lever'), copy = lever.cloneNode(true)
    copy.disabled = false
    lever.after(copy)
    try { return ${lookOf('copy')} } finally { copy.remove() }
  })()`)
  const turn = `getComputedStyle(document.querySelector('.ab-lever')).transform`
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
  await sleep(400) // longer than the lever's 0.25s turn
  const hovered = await browser.evaluate<string>(turn)
  await browser.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...at,
    button: 'left',
    clickCount: 1,
  })
  await sleep(400)
  const pressed = await browser.evaluate<string>(turn)
  await browser.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...at,
    button: 'left',
    clickCount: 1,
  })
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...away })
  assert.notDeepEqual(
    off,
    working,
    `the off lever looks like one that works: ${JSON.stringify(off)}`,
  )
  assert.notEqual(cursor, workingCursor, `the off lever has the ${cursor} cursor of one that works`)
  assert.equal(hovered, 'none', 'the off lever tilts on hover')
  assert.equal(pressed, 'none', 'the off lever swings when pressed')
})

// The 1990s on the page, as a first visit records them, and the decade's mood pool (REC-2).
const NINETIES = listsOf(recordings().get('first-visit')!).era.map(cardOf)
const POOL = recordedPool('1990s').titles
// Cowboy Bebop and Neon Genesis Evangelion, both in the 1990s.
const SAVED = [1, 30]

/**
 * Loads Discover, on a first visit, with nothing saved but `ids` on My List, Saved: written on the
 * site's own page, before the load that reads it. Reduced motion opens each capsule at once. Gives
 * what that load asks AniList for from then on (see askedFor).
 */
async function loadWithList(ids: number[]) {
  await browser.rewriteAniList(null)
  await browser.forget()
  await browser.load({ reduceMotion: true })
  await browser.evaluate(`(() => {
    const now = Date.now()
    localStorage.setItem('anibeam:list:v1', JSON.stringify(Object.fromEntries(${JSON.stringify(ids)}.map((id, i) => [id, { status: 'SAVED', favorite: false, updatedAt: now - i }]))))
    return true
  })()`)
  // Away first: the page the list was written on sees it too, and could ask for a pool of its own.
  await browser.send('Page.navigate', { url: 'about:blank' })
  await browser.waitFor(`location.href === 'about:blank'`)
  const asked: string[] = []
  await browser.rewriteAniList(({ request }) => {
    asked.push(askedFor(request))
    return null
  })
  await browser.load({ reduceMotion: true, url: BASE_URL })
  assert.ok(await browser.titlesShown(), 'no titles on the page')
  return asked
}

/** Of what a load asked AniList for, the mood pools, alone or with their decade's page. */
const pools = (asked: string[]) => asked.filter((what) => what.includes('pool'))

test('pulls skip My List, and no pull repeats one of the last 30, kept across a visit to My List; the pool is asked for once, as fewer than 10 titles are left', async () => {
  const asked = await loadWithList(SAVED)
  // Both are in the decade row, so the machine holds them.
  assert.deepEqual(
    await browser.evaluate(
      `${JSON.stringify(SAVED)}.filter((id) => !document.querySelector('.ab-strip-row a[href="/anime/' + id + '"]'))`,
    ),
    [],
    'saved titles missing from the page',
  )
  // The machine holds the 1990s' titles on the page, until fewer than 10 of them are left to come
  // up: then the pull wants the decade's pool, which holds more. Until then, no pull asks AniList
  // for anything.
  // A pull wants it when fewer than NEED_MORE are left before it picks: the pulls before leave
  // NEED_MORE or more.
  const left = pullable(NINETIES).filter(({ id }) => !SAVED.includes(id)).length
  const early = left - NEED_MORE + 1
  const before = await pulls(early)
  const quiet = [...pools(asked)]
  const last = await pulls(1)
  assert.ok(
    await poll(async () => pools(asked).length > 0, 10_000),
    'the pull that left fewer than 10 asked for no pool',
  )
  assert.ok(await browser.waitFor(poolSaved), 'the pool never arrived')
  // With Math.random fixed at 0, each pull takes the first title it may: the page's own order,
  // then the pool's, where both saved titles come within the first 30. A saved title let through
  // would come out, and a pull that forgot the last ones would give the same two over and over.
  const pulled = [...before, ...last, ...(await pulls(30 - early - 1))]
  assert.deepEqual(
    { quiet, after: pools(asked) },
    { quiet: [], after: ['pool 1990s'] },
    `the pools asked for in ${early} pulls, then after one more`,
  )
  assert.deepEqual(
    pulled.flatMap((href, i) => (href ? [] : [i + 1])),
    [],
    'pulls that never opened',
  )
  const saved = SAVED.map((id) => `/anime/${id}`)
  assert.deepEqual(
    pulled.filter((href) => saved.includes(href!)),
    [],
    'pulls that gave a title on My List',
  )
  assert.deepEqual(
    pulled.filter((href, i) => pulled.indexOf(href) !== i),
    [],
    'titles that came up twice in 30 pulls',
  )
  // The last 30 are kept for the visit. After a trip to My List and back, which draws the machine
  // anew, no pull gives one of the 30 before it: the first, one of the 5 titles of the 35 not
  // pulled yet, not the first title again, as a machine that forgot would give. My List's request
  // is answered with no titles: the page there isn't what this checks.
  await browser.rewriteAniList(({ request }) =>
    request.query === QUERIES.list
      ? { status: 200, body: { data: { Page: { media: [] } } } }
      : null,
  )
  await browser.evaluate(
    `document.querySelector('.ab-intro-actions a[href="/list"]').click(); true`,
  )
  assert.ok(
    await browser.waitFor(`location.pathname === '/list' && !document.getElementById('pull')`),
    'My List did not take the machine’s place',
  )
  await browser.evaluate('history.back(); true')
  assert.ok(
    await browser.waitFor(`location.pathname === '/' && document.querySelector('.ab-lever')`),
    'Back did not bring the machine back',
  )
  const all = [...pulled, ...(await pulls(5))]
  assert.deepEqual(
    all.flatMap((href, i) =>
      i >= 30 && (!href || saved.includes(href) || all.slice(i - 30, i).includes(href))
        ? [`pull ${i + 1}: ${href}`]
        : [],
    ),
    [],
    'after a trip to My List, pulls that gave one of the 30 before, a saved title, or none',
  )
  // And the ring holds 30, no more. Pull 31 pushes pull 1's title out of it, and as that title
  // comes first in the pool's order of those left, pull 32 gives it again. A ring that never let
  // go within the visit would give a title not pulled yet.
  assert.equal(all[31], all[0], 'pull 32 is not pull 1’s title, back once 30 others came up')
  assert.deepEqual(pools(asked), ['pool 1990s'], 'the pools asked for, in all')
})

/**
 * Pulls `times` in page script with Math.random fixed at 0, each once the last has opened (at
 * once, under reduced motion), and gives each pulled title's address, or null for a pull that
 * never opened.
 */
function pulls(times: number) {
  return browser.evaluate<(string | null)[]>(`(async () => {
    const random = Math.random
    Math.random = () => 0
    const pulled = []
    try {
      document.querySelector('#pull').scrollIntoView()
      for (let i = 0; i < ${times}; i++) {
        document.querySelector('.ab-result')?.setAttribute('data-old', '')
        document.querySelector('.ab-lever').click()
        let panel = null
        for (let wait = 0; wait < 100 && !(panel = document.querySelector('.ab-result.is-open:not([data-old]) .ab-result-panel')); wait++)
          await new Promise((resolve) => setTimeout(resolve, 5))
        pulled.push(panel?.getAttribute('href') ?? null)
      }
    } finally {
      Math.random = random
    }
    return pulled
  })()`)
}

/** The machine's mood slider named `label` set to `stop`, as a key or a drag sets it. */
function setSlider(label: string, stop: number) {
  return browser.evaluate(`(() => {
    const input = [...document.querySelectorAll('.ab-pull input[type="range"]')].find((input) => input.labels[0].textContent === '${label}')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${stop}')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
}

test('with a slider set, a pull gives the best match of the decade’s pool not pulled yet, by the mood scoring', async () => {
  const asked = await loadWithList([])
  // The mood scoring is a file of its own, which the page loads once it is idle (loadScoring.ts).
  assert.ok(
    await browser.waitFor(
      `performance.getEntriesByType('resource').some((entry) => entry.name.includes('/features/mood/scoring'))`,
      10_000,
    ),
    'the mood scoring never loaded',
  )
  // With Math.random fixed at 0, a pull takes the first of the 12 best matches that isn't among
  // the pulls before it: two at Very cozy, then two at Very high-octane.
  // The first slider set asks for the decade's pool, which the pulls then rank, once it is in.
  const steps: [number, Sliders][] = [
    [2, { energy: -2, tone: 0, complexity: 0 }],
    [2, { energy: 2, tone: 0, complexity: 0 }],
  ]
  const expected: number[] = []
  for (const [times, sliders] of steps)
    for (let i = 0; i < times; i++)
      expected.push(rankMatches(POOL, sliders).find(({ id }) => !expected.includes(id))!.id)
  // A machine that ignored the sliders would give the pool's first titles, in order.
  assert.notDeepEqual(
    expected,
    POOL.slice(0, expected.length).map(({ id }) => id),
    'the sliders pick what no preference would, so this check would show nothing',
  )
  const pulled: (string | null)[] = []
  for (const [times, sliders] of steps) {
    await setSlider('Energy', sliders.energy)
    assert.ok(await browser.waitFor(poolSaved), 'the pool never arrived')
    await browser.evaluate(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
    )
    pulled.push(...(await pulls(times)))
  }
  assert.deepEqual(
    pulled,
    expected.map((id) => `/anime/${id}`),
    'pulls at Very cozy, then at Very high-octane',
  )
  assert.deepEqual(pools(asked), ['pool 1990s'], 'the pools asked for')
})

test('with every title in the decade on My List, the machine asks once for its pool, then its lever is off and it says so', async () => {
  // The page's 20 and the pool's titles: none of the page's can come up, so the pool is wanted with
  // no press, and none of its can either.
  const asked = await loadWithList([...new Set([...NINETIES, ...POOL].map(({ id }) => id))])
  assert.ok(await poll(async () => pools(asked).length > 0, 10_000), 'the pool was never asked for')
  assert.ok(await browser.waitFor(poolSaved), 'the pool never arrived')
  await browser.evaluate(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
  )
  assert.deepEqual(pools(asked), ['pool 1990s'], 'the pools asked for')
  const machine = await browser.evaluate<{ off: boolean; hint: string; capsules: number }>(`({
    off: document.querySelector('.ab-lever').disabled,
    hint: document.querySelector('.ab-hint')?.textContent ?? '',
    capsules: document.querySelectorAll('.ab-capsule').length,
  })`)
  assert.deepEqual(machine, {
    off: true,
    hint: 'Everything in the machine is on your list. Try another decade below.',
    capsules: 0,
  })
})
