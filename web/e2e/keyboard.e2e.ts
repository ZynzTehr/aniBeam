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
