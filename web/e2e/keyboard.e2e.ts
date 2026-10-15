// The page by keyboard alone: where focus goes, and that it always shows. Spec §5 and WCAG 2.4.7
// (focus visible), 2.4.11 (focus not obscured) and 2.1.1 (keyboard).
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Browser } from './browser.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open()
})
after(() => browser?.close())

// What has focus, and how much of it the sticky header hides: a chip's radio button is see-through,
// so for a chip it is its pill that shows. Only where the header is drawn on top does it hide
// anything: its own links are in it, and the skip links are drawn over it.
const FOCUSED = `(() => {
  const focused = document.activeElement
  if (!focused || focused === document.body) return { name: 'nothing', hidden: 0 }
  const shown = (focused.matches('.ab-chip input') ? focused.nextElementSibling : focused).getBoundingClientRect()
  const header = document.querySelector('.ab-top')
  const under = header.getBoundingClientRect().bottom
  const covering = shown.top < under && header.contains(document.elementFromPoint(shown.left + shown.width / 2, Math.max(shown.top, 0) + 1))
  const sticky = getComputedStyle(header).position === 'sticky' && !header.contains(focused) && covering
  const name = (focused.getAttribute('aria-label') || focused.textContent || focused.value || focused.placeholder || focused.tagName)
    .replace(/\\s+/g, ' ').trim().slice(0, 40)
  return { name, hidden: sticky ? Math.round(Math.max(0, Math.min(shown.bottom, under) - Math.max(shown.top, 0))) : 0 }
})()`

test('from 900px, focus never lands under the sticky header, going back with Shift+Tab or by the skip link', async () => {
  const seen: string[] = []
  // At 960px with WCAG's widened text spacing (1.4.12), the header takes a second row, 135px.
  // It waits until the header has settled and published its height (--top-h): the search bubble
  // measures its wider text a frame later, which wraps the header a frame after, and --top-h
  // follows a frame after that. So the two must agree for 5 frames running.
  const SPACING = `(async () => {
    const style = document.head.appendChild(document.createElement('style'))
    style.textContent = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important } p { margin-bottom: 2em !important }'
    const header = document.querySelector('.ab-top')
    for (let agreed = 0; agreed < 5; ) {
      await new Promise(requestAnimationFrame)
      const published = getComputedStyle(document.documentElement).getPropertyValue('--top-h')
      agreed = published === header.offsetHeight + 'px' ? agreed + 1 : 0
    }
    return true
  })()`
  for (const { spacing, ...screen } of [
    { width: 1440, height: 900, spacing: false },
    { width: 1024, height: 768, spacing: false },
    { width: 960, height: 900, spacing: true },
  ]) {
    await browser.load({ ...screen, reduceMotion: true })
    if (spacing) await browser.evaluate(SPACING)
    assert.ok(await browser.titlesShown())
    // From the footer's Reduce motion switch, back through every stop to the top of the page.
    await browser.press('Tab')
    await browser.evaluate(`document.getElementById('reduce-motion').focus(); true`)
    for (let stop = 0; stop < 80; stop++) {
      await browser.press('Tab', true)
      const { name, hidden } = await browser.evaluate<{ name: string; hidden: number }>(FOCUSED)
      if (hidden > 0)
        seen.push(`${screen.width}px: Shift+Tab to "${name}", ${hidden}px under the header`)
      if (name === 'Skip to content' || name === 'nothing') break
    }
    // The skip link to the content, from the top of the page, once the titles have landed (as
    // they land, what is on screen keeps its place, which can move the page): the content starts
    // below the header.
    await browser.load({ ...screen, reduceMotion: true })
    if (spacing) await browser.evaluate(SPACING)
    assert.ok(await browser.titlesShown())
    await browser.press('Tab')
    await browser.press('Enter')
    const main = await browser.evaluate<number>(
      `Math.round(document.querySelector('.ab-top').getBoundingClientRect().bottom - document.getElementById('main').getBoundingClientRect().top)`,
    )
    if (main > 0)
      seen.push(
        `${screen.width}px: the skip link leaves the content's top ${main}px under the header`,
      )
    // And the header's own controls take focus where the visitor is: as scroll padding for the
    // whole page, the header's height had Chrome scroll to the top as its search box took focus.
    const moved = await browser.evaluate<number>(`(() => {
      scrollTo(0, 1500)
      document.querySelector('.ab-search input').focus()
      return Math.round(scrollY) - 1500
    })()`)
    if (moved) seen.push(`${screen.width}px: focusing the search box moved the page ${moved}px`)
  }
  assert.deepEqual(seen, [], 'focus under the sticky header')
})

test('a title card taller than the screen shows its focus ring, inside its edge, as Tab reaches it', async () => {
  // Taller than the screen, the card scrolls, and Chrome makes it a Tab stop of its own. Its ring
  // must show on the screen: inside its edge, which is the screen's, on the title's color.
  const seen: string[] = []
  for (const screen of [
    { width: 390, height: 844, phone: true },
    { width: 1280, height: 600 },
  ]) {
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    await browser.evaluate(`document.querySelector('.ab-grid .ab-link').focus(); true`)
    await browser.press('Enter')
    assert.ok(await browser.waitFor(`document.querySelector('dialog.ab-card[open]')`, 5000))
    await browser.animationsDone()
    let card = false
    for (let stop = 0; stop < 10 && !card; stop++) {
      await browser.press('Tab')
      card = await browser.evaluate<boolean>(`document.activeElement?.matches('dialog.ab-card')`)
    }
    if (!card) {
      seen.push(`${screen.width}px: Tab never reached the card itself`)
      await browser.press('Escape')
      continue
    }
    // The card's left edge as the screen shows it, with its ring, then with focus taken off it and
    // all else as it was (focus moved on to Close would scroll the card, and the speed lines):
    // the ring must change the edge from top to bottom, at 3:1 or better against what is there
    // without it (the title's color, and the speed lines' white). The clip is in the page's
    // pixels, so it adds the page's scroll.
    const edge = async () => {
      const scrolled = await browser.evaluate<{ x: number; y: number }>(
        `({ x: scrollX, y: scrollY })`,
      )
      return screenPixels({ x: scrolled.x, y: scrolled.y, width: 8, height: screen.height })
    }
    // Scrolled by the keyboard, as it is a Tab stop for that: the ring stays on the screen's edge.
    await browser.press('End')
    await browser.evaluate(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
    )
    const focused = await edge()
    const ring = await browser.evaluate<string>(
      `(() => { const style = getComputedStyle(document.activeElement); return style.outlineStyle + ' ' + style.outlineWidth + ' ' + style.outlineColor + ', offset ' + style.outlineOffset })()`,
    )
    await browser.evaluate(`document.activeElement.blur(); true`)
    const unfocused = await edge()
    const at = ({ width, rgb }: { width: number; rgb: number[] }, x: number, y: number) =>
      rgb.slice((y * width + x) * 3, (y * width + x) * 3 + 3)
    const rows = Array.from({ length: screen.height }, (_, y) =>
      contrast(at(focused, 1, y), at(unfocused, 1, y)),
    )
    const shown = rows.filter((ratio) => ratio >= 3).length / rows.length
    if (shown < 0.95)
      seen.push(
        `${screen.width}px: ring ${ring}, at 3:1 on ${Math.round(shown * 100)}% of the card's edge`,
      )
    await browser.press('Escape')
  }
  assert.deepEqual(seen, [], 'the focused card shows no ring on the screen')
})

test('a chip Tab reaches at the foot of the screen shows its whole pill and focus ring', async () => {
  // A chip's radio button is see-through, and Tab scrolls only if what takes focus isn't on the
  // screen yet (a script's focus() centres it instead): were that the button's own 13px box, its
  // pill, and the ring 7px beyond, could hang off the screen's foot while it shows. So for each
  // group, focus goes to the stop before its chosen chip, the chip's pill is put 20px above the
  // screen's foot, the rest below, and Tab moves on to it.
  const seen: string[] = []
  for (const screen of [
    { width: 1440, height: 900 },
    { width: 390, height: 844, phone: true },
  ]) {
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    for (const group of ['.ab-moods', '.ab-eras']) {
      const chip = `document.querySelector('${group} input:checked')`
      await browser.evaluate(`${chip}.focus({ preventScroll: true }); true`)
      await browser.press('Tab', true)
      await browser.evaluate(`(() => {
        const label = ${chip}.nextElementSibling
        scrollTo({ top: label.getBoundingClientRect().top + scrollY - innerHeight + 20, behavior: 'instant' })
        return true
      })()`)
      await browser.press('Tab')
      const shown = await browser.evaluate<string>(`(() => {
        const input = ${chip}, label = input.nextElementSibling
        if (document.activeElement !== input) return 'Tab missed the chip'
        const pill = label.getBoundingClientRect(), ring = 7
        const cut = [pill.top - ring < 0 && 'the top', pill.bottom + ring > innerHeight && 'the bottom'].filter(Boolean)
        return label.textContent + (cut.length ? ', cut off at ' + cut.join(' and ') + ' (pill ' + Math.round(pill.top) + ' to ' + Math.round(pill.bottom) + 'px, the screen ' + innerHeight + 'px)' : '')
      })()`)
      if (shown.includes(',') || shown.startsWith('Tab missed'))
        seen.push(`${screen.width}px: ${shown}`)
    }
  }
  assert.deepEqual(seen, [], 'chips whose pill or ring Tab leaves off the screen')
})

test("each of the header's section links hands focus to its section's heading, and Tab goes on into it", async () => {
  // Following a link moves the page, and focus moves only to something that can take it: the
  // sections' headings can, so that a keyboard user goes on from there.
  const seen: string[] = []
  for (const screen of [
    { width: 1440, height: 900 },
    { width: 390, height: 844, phone: true },
  ]) {
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    for (const label of ['Trending', 'Pull', 'Decades']) {
      await browser.evaluate(`(() => {
        scrollTo({ top: 0, behavior: 'instant' })
        ;[...document.querySelectorAll('.ab-nav a')].find((link) => link.textContent === '${label}').focus()
        return true
      })()`)
      await browser.press('Enter')
      const where = `(() => {
        const focused = document.activeElement
        const section = focused.closest('section')
        return (focused.matches('h1, h2') ? 'the heading "' + focused.firstChild.textContent.trim() + '"' : focused.tagName.toLowerCase() + ' "' + focused.textContent.trim().slice(0, 20) + '"') + (section ? ' in #' + (section.querySelector('h1[id], h2[id]')?.id ?? '?') : '')
      })()`
      const landed = await browser.evaluate<string>(where)
      await browser.press('Tab')
      const next = await browser.evaluate<string>(where)
      const section = /in #([\w-]+)/.exec(landed)?.[1]
      if (!landed.startsWith('the heading') || !section || !next.endsWith(`in #${section}`))
        seen.push(`${screen.width}px, ${label}: focus on ${landed}, then Tab to ${next}`)
    }
  }
  assert.deepEqual(seen, [], "header links that don't hand focus to their section's heading")
})

/** The pixels of part of the page as the screen shows it, as red, green and blue for each pixel. */
async function screenPixels(clip: { x: number; y: number; width: number; height: number }) {
  const png = await browser.screenshot(clip)
  return browser.evaluate<{ width: number; rgb: number[] }>(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    return { width: image.width, rgb: [...data].filter((_, i) => i % 4 !== 3) }
  })()`)
}

/** WCAG's contrast between two colors given as red, green and blue from 0 to 255. */
function contrast(a: number[], b: number[]) {
  const luminance = (rgb: number[]) =>
    rgb
      .map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, k) => sum + v * [0.2126, 0.7152, 0.0722][k], 0)
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
