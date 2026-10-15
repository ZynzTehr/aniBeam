// Layout shift: how much the page jumps as it loads and as a visitor uses it, counted as Google's
// web-vitals counts CLS (see sessionWindow in browser.ts). Spec §9 asks for under 0.1, a "good"
// score, on Discover.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { Browser } from './browser.ts'

// A phone's width, without Chrome's mobile emulation: that marks every shift in the page's first
// half second as the visitor's input, as it counts its own setting up of the viewport as one, so
// a jump while the page loads would go uncounted. The layout is the phone's all the same: the
// page's breakpoints read the width.
const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

let browser: Browser
before(async () => {
  browser = await Browser.open()
  await browser.watchLayoutShifts()
})
after(() => browser?.close())

/** The page's layout shift, to 4 places, with what moved in the window that counts. */
async function shifted() {
  const { value, shifts } = await browser.layoutShift()
  return `${value.toFixed(4)}${shifts.length ? `: ${shifts.flatMap(({ moved = [] }) => moved).join(', ')}` : ''}`
}

test('the measure counts a block that pushes the page down after it has loaded', async () => {
  await browser.load(DESKTOP)
  assert.ok(await browser.titlesShown())
  await browser.animationsDone()
  await sleep(1000)
  // Not the visitor's doing: a script puts a tall block at the top of the page.
  await browser.evaluate(
    `document.querySelector('main').prepend(Object.assign(document.createElement('div'), { style: 'height: 400px' })); true`,
  )
  await sleep(300)
  const { value } = await browser.layoutShift()
  assert.ok(value > 0.1, `a 400px block pushing the page down read as ${value.toFixed(4)}`)
})

test('a first visit loads with a layout shift under 0.1, on a phone and on a wide screen, with motion or without', async () => {
  // With reduced motion too: with motion allowed the intro's text fades in, and an element still
  // invisible doesn't count as moving, so a jump while it fades would go uncounted.
  const seen: string[] = []
  for (const screen of [PHONE, DESKTOP])
    for (const reduceMotion of [false, true]) {
      await browser.forget()
      await browser.load({ ...screen, reduceMotion })
      assert.ok(await browser.titlesShown())
      await browser.animationsDone()
      await sleep(1000)
      const { value } = await browser.layoutShift()
      if (value >= 0.1)
        seen.push(`${screen.width}px${reduceMotion ? ', reduced motion' : ''}: ${await shifted()}`)
    }
  assert.deepEqual(seen, [], 'a first visit jumps')
})

test('while a section waits for its titles, "Loading…" shows on its first empty panel, and nothing moves as they land', async () => {
  // Each section's status: as a tag on its first empty panel, its own line taking no room (screen
  // readers still read the line), or in its line; and its panels' place under its heading.
  const where = `(() => {
    // Measured, then rounded once: the heading itself can move, as what is above it changes.
    const gap = (from, to) => Math.round(to.getBoundingClientRect().top - from.getBoundingClientRect().top)
    return [['trending', '.ab-page', '.ab-grid'], ['decades', '.ab-strip', '.ab-strip-row']].map(([name, section, row]) => {
      const part = document.querySelector(section)
      const line = part.querySelector('.ab-note')
      const panel = part.querySelector(row + '[aria-hidden] > li')
      const tag = panel?.querySelector('.ab-note-tag')
      const box = tag?.getBoundingClientRect(), room = panel?.getBoundingClientRect()
      const onPanel = box && box.width > 0 && box.top >= room.top && box.bottom <= room.bottom && box.left >= room.left && box.right <= room.right
      const status = !line.textContent
        ? 'no line'
        : onPanel && tag.textContent === line.textContent && line.getBoundingClientRect().height === 0
          ? '"' + line.textContent + '" as a tag on the first empty panel'
          : '"' + line.textContent + '" in a line of its own'
      return name + ': ' + status + ', panels ' + gap(part.querySelector('h2'), part.querySelector(row)) + 'px under the heading'
    })
  })()`
  const seen: Record<string, string[]> = {}
  for (const screen of [PHONE, DESKTOP]) {
    await browser.forget()
    await browser.holdAniList(2500)
    await browser.load({ ...screen, reduceMotion: true })
    const loading = await browser.evaluate<string[]>(where)
    assert.ok(await browser.titlesShown())
    await browser.holdAniList(0)
    const loaded = await browser.evaluate<string[]>(where)
    seen[`${screen.width}px`] = [...loading, ...loaded]
  }
  const under = (panels: Record<string, number>) => (name: string, text: string) =>
    `${name}: ${text}, panels ${panels[name]}px under the heading`
  // The panels sit as far under their heading while they wait as once the titles land.
  for (const [screen, [trending, decades, trendingAfter, decadesAfter]] of Object.entries(seen)) {
    const gap = (line: string) => Number(/panels (-?\d+)px/.exec(line)?.[1])
    const panels = { trending: gap(trendingAfter), decades: gap(decadesAfter) }
    assert.deepEqual(
      [trending, decades, trendingAfter, decadesAfter],
      [
        under(panels)('trending', '"Loading…" as a tag on the first empty panel'),
        under(panels)('decades', '"Loading…" as a tag on the first empty panel'),
        under(panels)('trending', 'no line'),
        under(panels)('decades', 'no line'),
      ],
      `at ${screen}, while the titles load, then once they land`,
    )
  }
})

test('while a decade loads, the strip draws one row of cards, its empty ones, as tall as its titles', async () => {
  // The strip's rows and its height from heading to foot: the same while it waits as once its
  // titles land, or the page under it jumps, and a visitor at the foot of the page is pulled up.
  const strip = `(() => {
    const strip = document.querySelector('.ab-strip')
    const rows = [...strip.querySelectorAll('.ab-strip-row')].filter((row) => row.getBoundingClientRect().height > 0)
    const height = Math.round(strip.getBoundingClientRect().bottom - strip.querySelector('h2').getBoundingClientRect().top)
    return rows.length + (rows.length === 1 ? ' row' : ' rows') + ', ' + height + 'px'
  })()`
  const seen: string[] = []
  for (const screen of [PHONE, DESKTOP]) {
    await browser.forget()
    await browser.holdAniList(2500)
    await browser.load({ ...screen, reduceMotion: true })
    const loading = await browser.evaluate<string>(strip)
    assert.ok(await browser.titlesShown())
    await browser.holdAniList(0)
    const loaded = await browser.evaluate<string>(strip)
    if (loading !== loaded)
      seen.push(`${screen.width}px: ${loading} while it waits, ${loaded} once its titles land`)
  }
  assert.deepEqual(seen, [], 'the strip changes size as its titles land')
})

test("the pull machine's hint keeps its size as the titles land and change what it says", async () => {
  // Before any titles it says they're on their way; once they land, to pick a vibe and pull. On a
  // phone the machine sits above the decades, so a hint that grew pushed them down.
  const seen: string[] = []
  for (const screen of [PHONE, DESKTOP]) {
    await browser.forget()
    await browser.holdAniList(2500)
    await browser.load({ ...screen, reduceMotion: true })
    // The box's height and the hint it shows: one, the others there only to hold the room, hidden
    // from eyes and from screen readers.
    const hint = `(() => {
      const box = document.querySelector('.ab-reveal')
      const hints = [...box.querySelectorAll('.ab-hint')]
      const shown = hints.filter((hint) => getComputedStyle(hint).visibility === 'visible')
      const read = hints.filter((hint) => !hint.closest('[aria-hidden="true"]'))
      if (shown.length !== 1 || read.length !== 1 || shown[0] !== read[0])
        return shown.length + ' hints shown, ' + read.length + ' read by screen readers'
      // The hints share one place, as tall as the tallest (the box can be taller, from 821px wide,
      // holding the room of a pulled title).
      const tallest = Math.max(...hints.map((hint) => hint.getBoundingClientRect().height))
      const place = box.querySelector('.ab-hints').getBoundingClientRect().height
      if (Math.abs(place - tallest) > 1)
        return 'the hints take ' + Math.round(place) + 'px for a tallest of ' + Math.round(tallest) + 'px'
      return Math.round(box.getBoundingClientRect().height) + 'px: ' + shown[0].textContent.split('.')[0]
    })()`
    const before = await browser.evaluate<string>(hint)
    assert.ok(await browser.titlesShown())
    await browser.holdAniList(0)
    const after = await browser.evaluate<string>(hint)
    if (
      !/^\d+px: /.test(before) ||
      !/^\d+px: /.test(after) ||
      before.split(':')[0] !== after.split(':')[0]
    )
      seen.push(`${screen.width}px: ${before}, then ${after}`)
  }
  assert.deepEqual(seen, [], 'the hint changes size')
})

test('a slow first load, seen at the decades, jumps under 0.1, on a phone and on a wide screen', async () => {
  // The answer held 2.5 s, the visitor already down at the decades as it lands.
  const seen: string[] = []
  for (const screen of [PHONE, DESKTOP])
    for (const reduceMotion of [false, true]) {
      await browser.forget()
      await browser.holdAniList(2500)
      await browser.load({ ...screen, reduceMotion })
      await browser.evaluate(
        `document.getElementById('decades').scrollIntoView({ block: 'start', behavior: 'instant' }); true`,
      )
      assert.ok(await browser.titlesShown())
      await browser.holdAniList(0)
      await sleep(1500)
      const { value } = await browser.layoutShift()
      if (value >= 0.1)
        seen.push(`${screen.width}px${reduceMotion ? ', reduced motion' : ''}: ${await shifted()}`)
    }
  assert.deepEqual(seen, [], 'the page jumps under the visitor as the titles land')
})
