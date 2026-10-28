// Layout shift: how much the page jumps as it loads and as a visitor uses it, counted as Google's
// web-vitals counts CLS (see sessionWindow in browser.ts). Spec §9 asks for under 0.1, a "good"
// score, on Discover.
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { RULE } from '../src/features/mood/moods.ts'
import { Browser } from './browser.ts'
import { LISTS, listsOf, recordings } from './recordings.ts'

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

// Each check fails on an uncaught exception, or a console error or warning, from the page while it
// ran (see Browser.problems).
let problemsBefore = 0
beforeEach(() => {
  problemsBefore = browser.problems.length
})
afterEach(() => {
  assert.deepEqual(browser.problems.slice(problemsBefore), [], 'the page reported problems')
})

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

// Each section's status while it waits, as a tag over its empty panels, from the first, with its
// own line taking no room, or in its line; and its panels' place under its heading.
const WHERE = `(() => {
  // Measured, then rounded once: the heading itself can move, as what is above it changes.
  const gap = (from, to) => Math.round(to.getBoundingClientRect().top - from.getBoundingClientRect().top)
  return [['trending', '.ab-page', '.ab-grid'], ['decades', '.ab-strip', '.ab-strip-row']].map(([name, section, row]) => {
    const part = document.querySelector(section)
    const line = part.querySelector('.ab-note')
    // The empty panels' row, which screen readers skip (the line says it all for them).
    const panels = part.querySelector('.ab-skeleton-fill')?.closest(row), first = panels?.querySelector('li')
    const skipped = !panels || panels.getAttribute('aria-hidden') === 'true' ? '' : ', its empty panels read by screen readers'
    const tag = part.querySelector('.ab-note-tag')
    const box = tag?.getBoundingClientRect(), room = panels?.getBoundingClientRect(), start = first?.getBoundingClientRect()
    const over = Boolean(box && room && start) && box.width > 0 && box.top >= room.top && box.bottom <= room.bottom && box.left >= room.left && box.right <= room.right
      && box.left >= start.left && box.left < start.right && box.top >= start.top && box.top < start.bottom
    // The line takes no room, and shows none of its text: it would spill out between the panels.
    const hidden = line.getBoundingClientRect().height === 0 && getComputedStyle(line).overflowY !== 'visible'
    const status = !line.textContent
      ? 'no line'
      : over && tag.textContent === line.textContent && hidden
        ? '"' + line.textContent + '" as a tag over the empty panels'
        : over && tag.textContent === line.textContent
          ? '"' + line.textContent + '" as a tag, its line spilling out'
          : '"' + line.textContent + '" in a line of its own'
    return name + ': ' + status + skipped + ', panels ' + gap(part.querySelector('h2'), part.querySelector(row)) + 'px under the heading'
  })
})()`

// The strip's rows and its height from heading to foot.
const STRIP = `(() => {
  const strip = document.querySelector('.ab-strip')
  const rows = [...strip.querySelectorAll('.ab-strip-row')].filter((row) => row.getBoundingClientRect().height > 0)
  const height = Math.round(strip.getBoundingClientRect().bottom - strip.querySelector('h2').getBoundingClientRect().top)
  return rows.length + (rows.length === 1 ? ' row' : ' rows') + ', ' + height + 'px'
})()`

// The pull machine's reveal box: its height and the hint it shows, the one hint shown and read, the
// others there only to hold the room, hidden from eyes and from screen readers.
const HINT = `(() => {
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

type Look = { where: string[]; heard: string[]; strip: string; hint: string }

// A slow first visit: AniList's answer held 2.5 s, the visitor down at the decades as it lands. How
// the page looks while it waits and once its titles land, and how far it jumped, taken once for
// each screen and motion setting, for every check that reads it: the loads were most of the time
// this file took.
const slowLoads = new Map<
  string,
  Promise<{ waiting: Look; landed: Look; value: number; shifted: string }>
>()
function slowLoad(screen: { width: number; height: number }, reduceMotion: boolean) {
  const key = `${screen.width}px${reduceMotion ? ', reduced motion' : ''}`
  let load = slowLoads.get(key)
  if (!load) {
    load = (async () => {
      const look = async (waiting: boolean): Promise<Look> => ({
        where: await browser.evaluate<string[]>(WHERE),
        heard: waiting
          ? [await heard('trending', '.ab-page'), await heard('decades', '.ab-strip')]
          : [],
        strip: await browser.evaluate<string>(STRIP),
        hint: await browser.evaluate<string>(HINT),
      })
      await browser.forget()
      await browser.holdAniList(2500)
      try {
        await browser.load({ ...screen, reduceMotion })
        const waiting = await look(true)
        await browser.evaluate(
          `document.getElementById('decades').scrollIntoView({ block: 'start', behavior: 'instant' }); true`,
        )
        assert.ok(await browser.titlesShown())
        await browser.holdAniList(0)
        const landed = await look(false)
        await sleep(1500)
        const { value } = await browser.layoutShift()
        return { waiting, landed, value, shifted: await shifted() }
      } finally {
        await browser.holdAniList(0)
      }
    })()
    slowLoads.set(key, load)
  }
  return load
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
  // See WHERE. And screen readers must still read the line, once: the tag is for the eyes alone
  // (see heard).
  const seen: Record<string, string[]> = {}
  const read: Record<string, string[]> = {}
  for (const screen of [PHONE, DESKTOP]) {
    const { waiting, landed } = await slowLoad(screen, true)
    seen[`${screen.width}px`] = [...waiting.where, ...landed.where]
    read[`${screen.width}px`] = waiting.heard
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
  // empty panels, its text not spilling out of it, and each of its lines inside its rounded shape;
  // and it must keep as clear of the right end of what holds it as of the left.
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
    const panels = tag.closest('section').querySelector('.ab-skeleton-fill').closest('.ab-grid, .ab-strip-row').getBoundingClientRect()
    if (box.left < panels.left || box.right > panels.right || box.top < panels.top || box.bottom > panels.bottom) problems.push('beyond its empty panels')
    // As far from the right end of what holds it as from its left.
    const holder = tag.offsetParent.getBoundingClientRect()
    if (holder.right - box.right < box.left - holder.left - 0.5) problems.push(Math.round(holder.right - box.right) + 'px from its right end, ' + Math.round(box.left - holder.left) + 'px from its left')
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
          `(() => {
            const tags = [...document.querySelectorAll('.ab-note-tag')]
            return tags.every((tag) => tag.textContent.includes('Trying again')) && new Set(tags.map((tag) => tag.closest('section'))).size === 2
          })()`,
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
  const seen: string[] = []
  for (const screen of [PHONE, DESKTOP]) {
    const { waiting, landed } = await slowLoad(screen, true)
    if (waiting.strip !== landed.strip)
      seen.push(
        `${screen.width}px: ${waiting.strip} while it waits, ${landed.strip} once its titles land`,
      )
  }
  assert.deepEqual(seen, [], 'the strip changes size as its titles land')
})

test('while a newly picked decade loads, the strip keeps one row, the last decade’s titles, as tall', async () => {
  // Picked once the 1990s have landed, the 1980s take 2.5 s to come: meanwhile the strip shows the
  // 1990s, its rows and height as they were (a row of empty cards on top of them pushed the page
  // under it down, and up again as the 1980s landed), and the same once the 1980s land. And the
  // row: the 1990s stay where the visitor had scrolled them, at Ch.5, and the 1980s open at Ch.1,
  // however the visitor scrolled the 1990s while waiting (to Ch.3 here).
  const first = `document.querySelector('.ab-strip-row .ab-strip-panel[href] .ab-strip-title')?.textContent`
  const row = `document.querySelector('.ab-strip-row:not([aria-hidden])')`
  const scrollTo = (chapter: number) =>
    browser.evaluate<number>(`new Promise((resolve) => {
      ${row}.children[${chapter - 1}].scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'instant' })
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(${row}.scrollLeft))))
    })`)
  const scrolled = () => browser.evaluate<number>(`Math.round(${row}.scrollLeft)`)
  const seen: string[] = []
  for (const screen of [PHONE, DESKTOP]) {
    await browser.forget()
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    const nineties = await browser.evaluate<string>(first)
    const before = await browser.evaluate<string>(STRIP)
    const atCh5 = await scrollTo(5)
    assert.ok(atCh5 > 0, `${screen.width}px: the 1990s row didn't scroll to Ch.5`)
    await browser.holdAniList(2500)
    try {
      await browser.evaluate(
        `document.querySelector('.ab-eras input[value="1980s"]').click(); true`,
      )
      // Past the chips' pause (300 ms), with the 1980s on their way.
      await sleep(800)
      const kept = await scrolled()
      const loading =
        (await browser.evaluate<string>(STRIP)) +
        ((await browser.evaluate<string>(first)) === nineties ? '' : ', the 1990s gone') +
        (Math.abs(kept - atCh5) <= 1 ? '' : `, the row moved from ${atCh5}px to ${kept}px`)
      await scrollTo(3)
      assert.ok(
        await browser.waitFor(`${first} !== ${JSON.stringify(nineties)}`, 10_000),
        `${screen.width}px: the 1980s never landed`,
      )
      const opened = await scrolled()
      const loaded =
        (await browser.evaluate<string>(STRIP)) +
        (opened === 0 ? '' : `, the 1980s opening ${opened}px along, not at Ch.1`)
      if (new Set([before, loading, loaded]).size > 1)
        seen.push(
          `${screen.width}px: ${before}, then ${loading} while the 1980s load, then ${loaded}`,
        )
    } finally {
      await browser.holdAniList(0)
    }
  }
  assert.deepEqual(seen, [], 'the strip changes as a picked decade loads')
})

test("the pull machine's hint keeps its size as the titles land and change what it says", async () => {
  // Before any titles it says they're on their way; once they land, to pick a vibe and pull. On a
  // phone the machine sits above the decades, so a hint that grew pushed them down.
  const seen: string[] = []
  for (const screen of [PHONE, DESKTOP]) {
    const { waiting, landed } = await slowLoad(screen, true)
    const [before, after] = [waiting.hint, landed.hint]
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
  // See slowLoad.
  const seen: string[] = []
  for (const screen of [PHONE, DESKTOP])
    for (const reduceMotion of [false, true]) {
      const { value, shifted } = await slowLoad(screen, reduceMotion)
      if (value >= 0.1)
        seen.push(`${screen.width}px${reduceMotion ? ', reduced motion' : ''}: ${shifted}`)
    }
  assert.deepEqual(seen, [], 'the page jumps under the visitor as the titles land')
})

test('a search with no matches jumps under 0.1 as its line shows with the link to the mood sliders, at 768px as at 390 and 1440, the line one line tall, as without its link', async () => {
  // The link follows the results' line, "No titles found.", in the same line (see SearchResults in
  // App.tsx): wrapping to a line of its own, it would push down everything under the results.
  const seen: Record<string, string> = {}
  for (const screen of [PHONE, { width: 768, height: 1024 }, DESKTOP]) {
    await browser.load(screen)
    assert.ok(await browser.titlesShown())
    await browser.animationsDone()
    await sleep(1000)
    await browser.search('zzqqxx')
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-results .ab-note a')`),
      `${screen.width}px: no link to the mood sliders`,
    )
    await sleep(1000)
    const { value } = await browser.layoutShift()
    const line = await browser.evaluate<string>(`(() => {
      const note = document.querySelector('.ab-results .ab-note'), link = note.querySelector('a')
      const tall = note.getBoundingClientRect().height
      const lines = Math.round(tall / parseFloat(getComputedStyle(note).lineHeight))
      link.style.display = 'none'
      const alone = note.getBoundingClientRect().height
      link.style.removeProperty('display')
      return (lines === 1 ? 'one line' : lines + ' lines') + (tall === alone ? ', as without its link' : ', ' + alone + 'px tall without its link, ' + tall + 'px with it')
    })()`)
    seen[`${screen.width}px`] = `${line}, ${value < 0.1 ? 'under 0.1' : await shifted()}`
    await browser.search('')
  }
  const fine = 'one line, as without its link, under 0.1'
  assert.deepEqual(seen, { '390px': fine, '768px': fine, '1440px': fine })
})

test('a pull on a phone jumps under 0.1, and the next one too, its title laid out at the press', async () => {
  // With motion allowed, the capsule drops and the card turns for ROLL_MS (700 ms) before it shows
  // the title, more than the half second after a press that doesn't count. So the card is laid out
  // at the press: its faces unseen until the capsule pops open, its text invisible and both out of
  // reach (inert) until it shows, and showing it moves nothing.
  await browser.forget()
  await browser.load(PHONE)
  assert.ok(await browser.titlesShown())
  await browser.animationsDone()
  const result = `(() => {
    const result = document.querySelector('.ab-result:not([data-old])')
    if (!result) return 'no result'
    const poster = result.querySelector('.ab-result-panel'), copy = result.querySelector('.ab-result-copy')
    if (!poster || !copy) return 'no title laid out'
    const seen = (part) => part.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    const faces = [...result.querySelectorAll('.ab-face')]
    const hidden = poster.inert && copy.inert && !seen(copy) && faces.length === 2 && !faces.some(seen)
    const shown = !poster.inert && !copy.inert && seen(copy) && seen(poster)
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
    // The title's entrance and its burst play as the card shows, not at the press, unseen.
    const entering =
      await browser.evaluate<boolean>(`['.ab-result-copy', '.ab-sfx-tier', '.ab-burst'].every((part) =>
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
    // And what a finger or the mouse finds at the middle of the poster, the title, Save, Details
    // and Roll again, each brought to the middle of the screen: that part, not the burst or
    // anything else on top.
    const presses = await browser.evaluate<string>(`(() => {
      const result = document.querySelector('.ab-result.is-open:not([data-old])')
      const parts = { 'the poster': '.ab-result-panel', 'the title': 'h3', 'Save': '.ab-mylist .ab-btn', 'Details': '.ab-row-actions .ab-btn', 'Roll again': '.ab-row-actions .ab-btn:last-child' }
      const missed = Object.entries(parts).flatMap(([name, selector]) => {
        const part = result.querySelector(selector)
        part.scrollIntoView({ block: 'center', behavior: 'instant' })
        const box = part.getBoundingClientRect()
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return part.contains(hit) ? [] : [name + ' finds .' + (hit?.classList[0] ?? hit?.tagName)]
      })
      return missed.length ? 'a press on ' + missed.join(', on ') : 'each part takes its press'
    })()`)
    seen.push(
      `${pull}: ${pressed} at the press, ${opened} once open, ${entering ? 'entering as it opens' : 'no entrance as it opens'}, animating ${animating}, ${value < 0.1 ? 'under 0.1' : await shifted()}, ${presses}`,
    )
  }
  const height = (line: string) => /(\d+)px once open/.exec(line)?.[1]
  assert.deepEqual(
    seen,
    seen.map(
      (line, i) =>
        `${['first', 'second'][i]}: hidden and inert, ${height(line)}px at the press, shown with its burst, ${height(line)}px once open, entering as it opens, animating opacity and transform, under 0.1, each part takes its press`,
    ),
    'each pull',
  )
})

test('at 280px the rolled card fits the screen whole, its rarity’s rule, My List row, Details and Roll again too, and a roll after it moves nothing', async () => {
  // The plan's PR 4, commit 6: a phone zoomed to 125% or more. Each part of the card keeps one
  // size from roll to roll (two lines of title, one of season, two of Why and two of the rule), so
  // with motion allowed, its card laid out at the press, three rolls after the first shift nothing
  // at all, pressed from page script, so no shift is let off as the visitor's input. The card's
  // title is brought to the top of the screen, so its text, its buttons and the matches under it
  // are on it (a shift off the screen counts for nothing); Math.random at 0 rolls the decade's
  // most popular titles in turn, the same every run, one or two lines long at this width.
  await browser.load({ width: 280, height: 653 })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const roll = async () => {
    await browser.evaluate(`(() => {
      document.querySelector('.ab-result')?.setAttribute('data-old', '')
      const random = Math.random
      Math.random = () => 0
      document.querySelector('.ab-lever').click()
      Math.random = random
      return true
    })()`)
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-result.is-open:not([data-old])')`, 5000),
      'a roll never opened',
    )
    await browser.animationsDone()
  }
  await browser.evaluate(`document.querySelector('#pull').scrollIntoView(), true`)
  await roll()
  // Each part, brought into view: its name, and how far it reaches past either side of the screen.
  const fits = await browser.evaluate<string[]>(`(() => {
    const card = document.querySelector('.ab-result.is-open')
    const parts = [...card.querySelectorAll('.ab-face, .ab-tier, h3, p, button')]
    return parts.flatMap((part) => {
      const box = part.getBoundingClientRect()
      const name = part.matches('button') ? part.textContent.trim() : part.className || part.localName
      const over = Math.max(0 - box.left, box.right - innerWidth)
      return part.matches('button') || over > 0.5 ? [name + (over > 0.5 ? ' reaches ' + over.toFixed(1) + 'px past the screen' : '')] : []
    })
  })()`)
  const wide = await browser.evaluate<number>(`document.documentElement.scrollWidth - innerWidth`)
  // What its rarity means, under its text (A11).
  const rule = await browser.evaluate<string>(
    `document.querySelector('.ab-result.is-open .ab-rule')?.textContent ?? 'none'`,
  )
  await browser.evaluate(
    `document.querySelector('.ab-result h3').scrollIntoView({ block: 'start', behavior: 'instant' }), true`,
  )
  await browser.evaluate('new Promise((resolve) => requestAnimationFrame(() => resolve(true)))')
  await browser.evaluate(`window.__takeLayoutShifts(), (window.__layoutShifts.length = 0), true`)
  const titles = [
    await browser.evaluate<string>(`document.querySelector('.ab-result h3').textContent`),
  ]
  for (let i = 0; i < 3; i++) {
    await roll()
    titles.push(
      await browser.evaluate<string>(`document.querySelector('.ab-result h3').textContent`),
    )
  }
  await sleep(500)
  const moved = await browser.evaluate<string[]>(
    `(window.__takeLayoutShifts(), window.__layoutShifts.map((shift) => shift.value.toFixed(4) + ': ' + shift.moved.join(', ')))`,
  )
  assert.deepEqual(
    { fits, wide, rule, moved, titles: new Set(titles).size },
    {
      fits: ['Save', 'Want to try', 'Favorite', 'Details', 'Roll again'],
      wide: 0,
      rule: RULE,
      moved: [],
      titles: 4,
    },
    `rolled ${titles.join(', ')}`,
  )
})

test('beside the machine, from 821 to 1170px and at 1180px beside a scrollbar, where the rolled card stacks, a first roll moves neither the lever nor what is under the card', async () => {
  // The card is taller stacked than the hint it takes the place of, so its row keeps the card's
  // room from the start: a first roll grew the row, moving the lever under the pointer, as the
  // machine sat in the middle of the row, and the matches and decades under it, 337px at 1024px.
  // Under 821px the card comes in under the machine, below the lever. A scrollbar that takes room,
  // as on Windows (17px here), narrows the reveal, so at 1180px the card stacks there too.
  const seen: string[] = []
  for (const [width, scrollbar] of [
    [821, false],
    [1024, false],
    [1170, false],
    [1180, true],
  ] as const) {
    await browser.load({ width, height: 900, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    await browser.landAll()
    if (scrollbar)
      await browser.evaluate(
        `document.head.append(Object.assign(document.createElement('style'), { textContent: 'html { overflow-y: scroll } ::-webkit-scrollbar { width: 17px }' })), true`,
      )
    const at = `${width}px${scrollbar ? ' beside a scrollbar' : ''}`
    const reveal = await browser.evaluate<number>(
      `document.querySelector('.ab-reveal').getBoundingClientRect().width`,
    )
    assert.ok(reveal <= 630, `${at}: the reveal is ${reveal}px wide, where the card doesn't stack`)
    const where = `['.ab-lever', '.ab-matches', '.ab-strip'].map((part) => Math.round(document.querySelector(part).getBoundingClientRect().top + scrollY))`
    const before = await browser.evaluate<number[]>(where)
    await browser.evaluate(`document.querySelector('.ab-lever').click(), true`)
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-result.is-open')`, 5000),
      'the roll never opened',
    )
    const after = await browser.evaluate<number[]>(where)
    const moved = ['the lever', 'the matches', 'the decades'].flatMap((part, i) =>
      after[i] === before[i] ? [] : [`${part} ${after[i] - before[i]}px`],
    )
    if (moved.length) seen.push(`${at}: ${moved.join(', ')}`)
  }
  assert.deepEqual(seen, [], 'a first roll moves the page')
})

test('a listed title’s stamp ends its cover’s name, shows inside its panel clear of the bubble, the rank and the rarity sticker, and moves nothing as it comes or changes, at 280 and 1440px; on My List, only what the view doesn’t say', async () => {
  // Phase 4's PR 4, item 1 (the plan's D4, option A): on trending, the decade strip, search and
  // the top matches, a listed title's cover shows a folder tab, SAVED or WANT with a heart for a
  // favorite, out of its caption's, title box's or frame's ink line. Seen, not heard: a screen
  // reader hears it at the end of the cover's name, inside the one link, with nothing to press;
  // on a match, before the period that ends it. At 280px, the narrowest phone, a half panel's tab
  // meets the score bubble's tail, a full-width panel's the rank number, and a match's, on a 73px
  // cover, the rarity sticker; from 900px panels 4 and 5 are cut on the diagonal. On My List a
  // stamp leaves out what the view already says: its tab's word, and the heart under Favorites
  // only.
  // The list comes as another tab's write does, by the storage event, with panels 4 and 5 on the
  // screen, so a stamp that took room, or grew in place as it changed, would count as a shift.
  await browser.load({ width: 280, height: 653, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const panel = (n: number) => `document.querySelector('.ab-grid > .ab-panel:nth-child(${n})')`
  const card = `document.querySelector('[aria-labelledby="decades"] .ab-strip-row:not([aria-hidden]) .ab-strip-panel[href]')`
  const idOf = (link: string) =>
    browser.evaluate<number>(`Number(${link}.getAttribute('href').split('/').pop())`)
  const [two, four, five, decade] = [
    await idOf(`${panel(2)}.querySelector('a')`),
    await idOf(`${panel(4)}.querySelector('a')`),
    await idOf(`${panel(5)}.querySelector('a')`),
    await idOf(card),
  ]
  const frieren = listsOf(recordings().get('search-frieren')!).Page[0].id
  // The first top match that isn't one of those.
  const match = await browser.evaluate<number>(
    `[...document.querySelectorAll('.ab-pull .ab-match[href]')].map((link) => Number(link.getAttribute('href').split('/').pop())).find((id) => !${JSON.stringify([two, four, five, decade, frieren])}.includes(id))`,
  )
  const matchLink = `document.querySelector('.ab-pull .ab-match[href="/anime/${match}"]')`
  const list = (fiveAs: string) => ({
    [two]: { status: 'SAVED', favorite: true },
    [four]: { status: 'WANT', favorite: true },
    [five]:
      fiveAs === 'saved'
        ? { status: 'SAVED', favorite: false }
        : { status: 'WANT', favorite: true },
    [decade]: { status: 'SAVED', favorite: true },
    [frieren]: { status: 'WANT', favorite: false },
    [match]: { status: 'SAVED', favorite: true },
  })
  const write = (entries: object) =>
    browser.evaluate(`(async () => {
      const now = Date.now()
      const json = JSON.stringify(Object.fromEntries(Object.entries(${JSON.stringify(entries)}).map(([id, entry]) => [id, { ...entry, updatedAt: now }])))
      localStorage.setItem('anibeam:list:v1', json)
      dispatchEvent(new StorageEvent('storage', { key: 'anibeam:list:v1', newValue: json }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await new Promise((resolve) => setTimeout(resolve, 300))
      window.__takeLayoutShifts()
      return window.__layoutShifts.splice(0).map((shift) => shift.value.toFixed(4) + ': ' + shift.moved.join(', '))
    })()`)
  // What a stamp shows, as its tab reads: its word, then ♥ for its heart.
  const tab = (link: string) =>
    `[...${link}.querySelectorAll('.ab-stamp')].map((tab) => tab.textContent + (tab.querySelector('svg') ? ' ♥' : '')).join(' | ')`
  try {
    await browser.evaluate(
      `${panel(4)}.scrollIntoView({ block: 'start', behavior: 'instant' }), window.__takeLayoutShifts(), (window.__layoutShifts.length = 0), true`,
    )
    const came = await write(list('saved'))
    const shown = await browser.evaluate<string>(tab(panel(5)))
    const changed = await write(list('want'))
    const now = await browser.evaluate<string>(tab(panel(5)))
    // Each cover's name, from Chrome's accessibility tree, as a screen reader hears it. Chrome
    // puts a space between the parts read out as words of their own (the season's, the stamp's),
    // which a screen reader doesn't say before a comma, so it is left out there. Not before a
    // match's period: a period alone after a space is said as "dot", so it ends the words before.
    const nameOf = async (link: string) => {
      const { result } = await browser.send('Runtime.evaluate', { expression: link })
      const { nodes } = await browser.send('Accessibility.getPartialAXTree', {
        objectId: result.objectId,
        fetchRelatives: false,
      })
      return (nodes[0].name.value as string).replace(/ (?=,)/g, '')
    }
    // A strip card's name as it should be: its title, its season (the words of its own that aren't
    // the stamp's), then the stamp's words.
    const named = (link: string, words: string) =>
      browser.evaluate<string>(
        `${link}.querySelector('.ab-strip-title > :first-child').textContent + [...${link}.querySelectorAll(':scope > .sr-only')].find((span) => !${JSON.stringify(words)}.startsWith(span.textContent)).textContent + ${JSON.stringify(words)}`,
      )
    const score = await browser.evaluate<string>(
      `${panel(2)}.querySelector('.ab-bubble').textContent`,
    )
    const trending = await nameOf(`${panel(2)}.querySelector('a')`)
    const decadeName = await nameOf(card)
    // A match's name as it should be: its title, its rarity in words, the stamp's, then a period
    // and its Why line, which says nothing until a slider moves; and a match not on the list, as
    // before the stamps, its rarity and the period.
    const matchName = await nameOf(matchLink)
    const matchNamed = (link: string, words: string) =>
      browser.evaluate<string>(
        `((link) => link.querySelector('.ab-match-title').textContent + ', ' + ((tier) => (tier === '?' ? 'Mystery' : tier))(link.querySelector('.ab-tier').textContent) + ${JSON.stringify(words)} + '.' + (link.querySelector('.ab-match-why').textContent && ' ' + link.querySelector('.ab-match-why').textContent))(${link})`,
      )
    const unlisted = `[...document.querySelectorAll('.ab-pull .ab-match[href]')].find((link) => !${JSON.stringify(Object.keys(list('want')))}.includes(link.getAttribute('href').split('/').pop()))`
    const unlistedName = await nameOf(unlisted)
    await browser.search('frieren')
    const result = `document.querySelector('.ab-results .ab-strip-panel[href="/anime/${frieren}"]')`
    assert.ok(await browser.waitFor(result, 10_000), 'Frieren never came up in the search')
    const names = {
      trending: trending.slice(trending.lastIndexOf(', scored')),
      decade: decadeName,
      search: await nameOf(result),
      match: matchName,
      unlisted: unlistedName,
    }
    const expected = {
      trending: `, scored ${score}, saved, favorite`,
      decade: await named(card, ', saved, favorite'),
      search: await named(result, ', want to try'),
      match: await matchNamed(matchLink, ', saved, favorite'),
      unlisted: await matchNamed(unlisted, ''),
    }
    // Where each stamp shows: inside the box that clips it (a panel's link, cut on the diagonal
    // from 900px on panels 4 and 5; a strip card), or a match's cover, and clear of the score
    // bubble and its tail, the rarity sticker, and at 280px of the rank number. There a full-width panel is short, and panel 4's caption,
    // its title on three lines, reaches up beside the number. From 900px the number's box runs
    // below its glyph, which the tab clears, so the box isn't held to it there.
    const placed = `((links, rank) => links.flatMap(([name, link]) => {
      const stamp = link.querySelector('.ab-stamp')
      if (!stamp) return [name + ': no stamp']
      const box = stamp.getBoundingClientRect()
      const edge = (link.querySelector('.ab-match-cover') ?? link).getBoundingClientRect()
      const wrong = []
      if (box.left < edge.left - 0.5 || box.top < edge.top - 0.5 || box.right > edge.right + 0.5 || box.bottom > edge.bottom + 0.5)
        wrong.push('outside its box')
      // The cut: a link's clip-path runs from (cut - 2px, 0) to (0, 100%) on panel 5, and from
      // (100%, 0) to (100% - cut + 2px, 100%) on panel 4.
      const li = link.parentElement
      const cut = getComputedStyle(li).clipPath === 'none' ? 0 : parseFloat(getComputedStyle(li).getPropertyValue('--cut')) - 2
      for (const y of [box.top, box.bottom]) {
        const down = (y - edge.top) / edge.height
        if (li.matches('.ab-cut-left') && cut && box.left < edge.left + cut * (1 - down) - 0.5) wrong.push('cut off by the diagonal')
        if (li.matches('.ab-cut-right') && cut && box.right > edge.right - cut * down + 0.5) wrong.push('cut off by the diagonal')
      }
      // The bubble and its tail, which hangs 14px below the bubble's padding box (11px below it).
      const bubble = link.querySelector('.ab-bubble')?.getBoundingClientRect()
      if (bubble && box.right > bubble.left && box.left < bubble.right && box.bottom > bubble.top && box.top < bubble.bottom + 11)
        wrong.push('over the bubble or its tail')
      const sticker = link.querySelector('.ab-tier')?.getBoundingClientRect()
      if (sticker && box.right > sticker.left && box.left < sticker.right && box.bottom > sticker.top && box.top < sticker.bottom)
        wrong.push('over the rarity sticker')
      const number = rank && link.querySelector('.ab-rank')?.getBoundingClientRect()
      if (number && box.right > number.left && box.left < number.right && box.bottom > number.top && box.top < number.bottom)
        wrong.push('over the rank number')
      return wrong.length ? [name + ': ' + [...new Set(wrong)].join(', ')] : []
    }))`
    const covers = `[['panel 2', ${panel(2)}.querySelector('a')], ['panel 4', ${panel(4)}.querySelector('a')], ['panel 5', ${panel(5)}.querySelector('a')], ['the top match', ${matchLink}]]`
    const at280 = await browser.evaluate<string[]>(
      `${placed}([...${covers}, ['the decade card', ${card}], ['the search result', ${result}]], true)`,
    )
    const nested = await browser.evaluate<number>(
      `document.querySelectorAll('a button, a a').length`,
    )
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await browser.evaluate(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
    )
    const at1440 = await browser.evaluate<string[]>(`${placed}(${covers})`)
    // In a contrast theme (forced colors), with no rule of its own, the tab keeps the theme's
    // colors for the link it is in, as its caption's frame does: its edge, word and heart in the
    // link color, on the theme's page color, in a light theme and a dark one.
    const themed: string[] = []
    for (const scheme of ['light', 'dark']) {
      await browser.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-color-scheme', value: scheme },
        ],
      })
      themed.push(
        await browser.evaluate<string>(`(() => {
          const color = (system) => {
            const probe = document.body.appendChild(document.createElement('i'))
            probe.style.color = system
            const value = getComputedStyle(probe).color
            probe.remove()
            return value
          }
          const named = { [color('LinkText')]: 'link', [color('Canvas')]: 'page', [color('CanvasText')]: 'text' }
          const stamp = ${panel(5)}.querySelector('.ab-stamp')
          if (!stamp) return ${JSON.stringify(scheme)} + ': no stamp'
          const style = getComputedStyle(stamp)
          const frame = getComputedStyle(stamp.parentElement).borderTopColor
          const as = (value) => named[value] ?? value
          return ${JSON.stringify(scheme)} + ': edge ' + as(style.borderTopColor) + (style.borderTopColor === frame ? ' as its frame' : ', its frame ' + as(frame)) + ', ' + style.borderTopWidth + ', word ' + as(style.color) + ', heart ' + as(getComputedStyle(stamp.querySelector('svg')).fill) + ', on ' + as(style.backgroundColor)
        })()`),
      )
    }
    // On My List, a stamp says only what the page doesn't: on the Saved tab, a saved favorite's
    // tab shows its heart alone, and its name ends ", favorite". The list-12 recording's titles,
    // the list My List can ask AniList for here, all saved, Frieren with the heart; the titles
    // listed above and not among them taken off, with delete markers, as the store keeps a title
    // that another tab's list only leaves out.
    await browser.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    await write({
      ...Object.fromEntries(
        Object.keys(list('want')).map((id) => [
          id,
          { status: 'SAVED', favorite: false, deleted: true },
        ]),
      ),
      ...Object.fromEntries(
        LISTS['list-12'].map((id) => [id, { status: 'SAVED', favorite: id === frieren }]),
      ),
    })
    await browser.evaluate(`document.querySelector('.ab-nav a[href="/list"]').click(), true`)
    const listed = `document.querySelector('.ab-list .ab-strip-panel[href="/anime/${frieren}"]')`
    assert.ok(await browser.waitFor(listed, 10_000), 'Frieren never showed on My List')
    const onList = { tab: await browser.evaluate<string>(tab(listed)), name: await nameOf(listed) }
    assert.deepEqual(
      { came, shown, changed, now, names, at280, nested, at1440, themed, onList },
      {
        came: [],
        shown: 'SAVED',
        changed: [],
        now: 'WANT ♥',
        names: expected,
        at280: [],
        nested: 0,
        at1440: [],
        themed: ['light', 'dark'].map(
          (scheme) => `${scheme}: edge link as its frame, 3px, word link, heart link, on page`,
        ),
        onList: { tab: ' ♥', name: await named(listed, ', favorite') },
      },
    )
  } finally {
    await browser.send('Emulation.setEmulatedMedia', { features: [] })
    await browser.evaluate(
      `localStorage.removeItem('anibeam:list:v1'), dispatchEvent(new StorageEvent('storage', { key: 'anibeam:list:v1', newValue: null })), true`,
    )
  }
})
