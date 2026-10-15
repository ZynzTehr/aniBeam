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
