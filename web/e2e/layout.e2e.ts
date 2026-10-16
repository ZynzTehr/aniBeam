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

/**
 * How a screen reader gets a section's status line, from Chrome's accessibility tree, not the
 * page's attributes: how many times the section says the line's text, and whether the line is a
 * status (a live region) that says it.
 */
async function heard(name: string, section: string) {
  const object = async (expression: string) =>
    (await browser.send('Runtime.evaluate', { expression })).result.objectId as string
  const text = await browser.evaluate<string>(
    `document.querySelector('${section} .ab-note').textContent`,
  )
  const { nodes: saying } = await browser.send('Accessibility.queryAXTree', {
    objectId: await object(`document.querySelector('${section}')`),
    accessibleName: text,
  })
  const {
    nodes: [line],
  } = await browser.send('Accessibility.getPartialAXTree', {
    objectId: await object(`document.querySelector('${section} .ab-note')`),
    fetchRelatives: false,
  })
  const status =
    !line.ignored &&
    line.role?.value === 'status' &&
    saying.some((node: any) => node.parentId === line.nodeId)
  const times = saying.length === 1 ? 'once' : `${saying.length} times`
  return `${name}: "${text}" read ${times}, ${status ? 'as a status' : 'not as a status'}`
}

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

test('while a section waits for its titles, "Loading…" shows over its empty panels, and nothing moves as they land', async () => {
  // Each section's status: as a tag over its empty panels, from the first, its own line taking no
  // room, or in its line; and its panels' place under its heading. And screen readers must still
  // read the line, once: the tag is for the eyes alone (see heard).
  const where = `(() => {
    // Measured, then rounded once: the heading itself can move, as what is above it changes.
    const gap = (from, to) => Math.round(to.getBoundingClientRect().top - from.getBoundingClientRect().top)
    return [['trending', '.ab-page', '.ab-grid'], ['decades', '.ab-strip', '.ab-strip-row']].map(([name, section, row]) => {
      const part = document.querySelector(section)
      const line = part.querySelector('.ab-note')
      const panels = part.querySelector(row + '[aria-hidden]'), first = panels?.querySelector('li')
      const tag = part.querySelector('.ab-note-tag')
      const box = tag?.getBoundingClientRect(), room = panels?.getBoundingClientRect(), start = first?.getBoundingClientRect()
      const over = box && box.width > 0 && box.top >= room.top && box.bottom <= room.bottom && box.left >= room.left && box.right <= room.right
        && box.left >= start.left && box.left < start.right && box.top >= start.top && box.top < start.bottom
      const status = !line.textContent
        ? 'no line'
        : over && tag.textContent === line.textContent && line.getBoundingClientRect().height === 0
          ? '"' + line.textContent + '" as a tag over the empty panels'
          : '"' + line.textContent + '" in a line of its own'
      return name + ': ' + status + ', panels ' + gap(part.querySelector('h2'), part.querySelector(row)) + 'px under the heading'
    })
  })()`
  const seen: Record<string, string[]> = {}
  const read: Record<string, string[]> = {}
  for (const screen of [PHONE, DESKTOP]) {
    await browser.forget()
    await browser.holdAniList(2500)
    await browser.load({ ...screen, reduceMotion: true })
    const loading = await browser.evaluate<string[]>(where)
    read[`${screen.width}px`] = [
      await heard('trending', '.ab-page'),
      await heard('decades', '.ab-strip'),
    ]
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
        under(panels)('trending', '"Loading…" as a tag over the empty panels'),
        under(panels)('decades', '"Loading…" as a tag over the empty panels'),
        under(panels)('trending', 'no line'),
        under(panels)('decades', 'no line'),
      ],
      `at ${screen}, while the titles load, then once they land`,
    )
  }
  const once = [
    'trending: "Loading…" read once, as a status',
    'decades: "Loading…" read once, as a status',
  ]
  assert.deepEqual(
    read,
    { '390px': once, '1440px': once },
    'what screen readers get while the titles load',
  )
})

test('while AniList fails, a section waiting for its titles shows its whole long status note in its tag, clear of the corners', async () => {
  // While the sections try again, their status says so at length ("AniList had a problem. It's not
  // something you did. Trying again in a few seconds."), where a phone's or a tablet's strip card
  // is 150px wide. Each tag must show all of it: none of it cut off by what holds the tag, over its
  // empty panels, its text not spilling out of it, and each of its lines inside its rounded shape.
  const TAGS = `[...document.querySelectorAll('.ab-note-tag')].map((tag) => {
    const name = tag.closest('.ab-page') ? 'trending' : 'decades'
    const box = tag.getBoundingClientRect(), style = getComputedStyle(tag)
    const problems = []
    for (let el = tag.parentElement; el && el !== document.body; el = el.parentElement) {
      const clips = getComputedStyle(el)
      if (clips.overflowX === 'visible' && clips.overflowY === 'visible') continue
      const r = el.getBoundingClientRect()
      if (box.left < r.left - 0.5 || box.right > r.right + 0.5 || box.top < r.top - 0.5 || box.bottom > r.bottom + 0.5)
        problems.push('cut off by .' + el.classList[0])
    }
    const panels = tag.closest('section').querySelector('[aria-hidden="true"]:is(.ab-grid, .ab-strip-row)').getBoundingClientRect()
    if (box.left < panels.left || box.right > panels.right || box.top < panels.top || box.bottom > panels.bottom) problems.push('beyond its empty panels')
    if (tag.scrollHeight > tag.clientHeight + 1 || tag.scrollWidth > tag.clientWidth + 1) problems.push('its text spills out')
    // Inside the white of its rounded shape: the box within its border, with the corners' radius
    // as drawn (no more than half the box), less the border.
    const border = parseFloat(style.borderTopWidth)
    const [left, top, right, bottom] = [box.left + border, box.top + border, box.right - border, box.bottom - border]
    const radius = Math.max(0, Math.min(parseFloat(style.borderTopLeftRadius), box.width / 2, box.height / 2) - border)
    const inside = (x, y) => {
      if (x < left - 0.5 || x > right + 0.5 || y < top - 0.5 || y > bottom + 0.5) return false
      const cx = Math.min(Math.max(x, left + radius), right - radius), cy = Math.min(Math.max(y, top + radius), bottom - radius)
      return Math.hypot(x - cx, y - cy) <= radius + 0.5
    }
    const range = document.createRange()
    range.selectNodeContents(tag)
    const lines = [...range.getClientRects()].filter((line) => line.width > 0)
    const out = lines.filter((line) => ![[line.left, line.top], [line.right, line.top], [line.left, line.bottom], [line.right, line.bottom]].every(([x, y]) => inside(x, y)))
    if (out.length) problems.push(out.length + ' of its ' + lines.length + ' lines run outside its rounded shape')
    return name + ': ' + (tag.textContent.includes('Trying again in a few seconds.') ? 'the whole note' : '"' + tag.textContent + '"') + (problems.length ? ', ' + problems.join(', ') : ', shown whole')
  })`
  const seen: Record<string, string[]> = {}
  for (const screen of [PHONE, { width: 834, height: 1112 }, DESKTOP]) {
    await browser.forget()
    await browser.rewriteAniList(() => ({
      status: 500,
      body: JSON.stringify({ errors: [{ message: 'Internal Server Error', status: 500 }] }),
    }))
    try {
      await browser.load({ ...screen, reduceMotion: true })
      assert.ok(
        await browser.waitFor(
          `[...document.querySelectorAll('.ab-note-tag')].filter((tag) => tag.textContent.includes('Trying again')).length === 2`,
          10_000,
        ),
        `${screen.width}px: the sections never said they were trying again`,
      )
      seen[`${screen.width}px`] = await browser.evaluate<string[]>(TAGS)
    } finally {
      await browser.rewriteAniList(null)
    }
  }
  const whole = ['trending: the whole note, shown whole', 'decades: the whole note, shown whole']
  assert.deepEqual(seen, { '390px': whole, '834px': whole, '1440px': whole })
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

test('a pull on a phone jumps under 0.1, and the next one too, its title laid out at the press', async () => {
  // With motion allowed, the capsule drops for 900 ms before it opens on the title, more than the
  // half second after a press that doesn't count. So the title's box is laid out at the press,
  // invisible and out of reach (inert) until the capsule opens, and the opening moves nothing.
  await browser.forget()
  await browser.load(PHONE)
  assert.ok(await browser.titlesShown())
  await browser.animationsDone()
  const result = `(() => {
    const result = document.querySelector('.ab-result:not([data-old])')
    if (!result) return 'no result'
    const parts = [result.querySelector('.ab-result-panel'), result.querySelector('.ab-result-copy')]
    if (parts.some((part) => !part)) return 'no title laid out'
    const hidden = parts.every((part) => getComputedStyle(part).visibility === 'hidden' && part.inert)
    const shown = parts.every((part) => getComputedStyle(part).visibility === 'visible' && !part.inert)
    // The burst of speed lines in the title's color comes with the opening, not before.
    const burst = result.querySelector('.ab-burst') ? ' with its burst' : ''
    return (hidden ? 'hidden and inert' : shown ? 'shown' : 'half shown') + burst + ', ' + Math.round(result.getBoundingClientRect().height) + 'px'
  })()`
  const seen: string[] = []
  for (const pull of ['first', 'second']) {
    const lever = await browser.evaluate<{ x: number; y: number }>(`(() => {
      document.querySelector('.ab-result')?.setAttribute('data-old', '')
      const lever = document.querySelector('.ab-lever')
      lever.scrollIntoView({ block: 'center', behavior: 'instant' })
      const box = lever.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    })()`)
    for (const type of ['mousePressed', 'mouseReleased'])
      await browser.send('Input.dispatchMouseEvent', {
        type,
        ...lever,
        button: 'left',
        clickCount: 1,
      })
    const pressed = await browser.evaluate<string>(result)
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-result.is-open:not([data-old])')`, 5000),
      `the ${pull} pull never opened`,
    )
    // The title's entrance and its burst play as the capsule opens, not at the press, unseen.
    const entering =
      await browser.evaluate<boolean>(`['.ab-result-panel', '.ab-result-copy', '.ab-sfx-tier', '.ab-burst'].every((part) =>
      document.querySelector('.ab-result.is-open:not([data-old]) ' + part)?.getAnimations().some((animation) => animation.playState === 'running'))`)
    // What the opening animates: only what moves nothing else, transform and opacity.
    const animating =
      await browser.evaluate<string>(`[...new Set(document.querySelector('.ab-result.is-open:not([data-old])')
      .getAnimations({ subtree: true }).flatMap((animation) => animation.effect.getKeyframes())
      .flatMap((keyframe) => Object.keys(keyframe).filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))))].sort().join(' and ')`)
    await browser.animationsDone()
    await sleep(1000)
    const opened = await browser.evaluate<string>(result)
    const { value } = await browser.layoutShift()
    seen.push(
      `${pull}: ${pressed} at the press, ${opened} once open, ${entering ? 'entering as it opens' : 'no entrance as it opens'}, animating ${animating}, ${value < 0.1 ? 'under 0.1' : await shifted()}`,
    )
  }
  const height = (line: string) => /(\d+)px once open/.exec(line)?.[1]
  assert.deepEqual(
    seen,
    seen.map(
      (line, i) =>
        `${['first', 'second'][i]}: hidden and inert, ${height(line)}px at the press, shown with its burst, ${height(line)}px once open, entering as it opens, animating opacity and transform, under 0.1`,
    ),
    'each pull',
  )
})
