// The page's section links (spec §5): the intro's three buttons, which fly into the header as it
// reaches them, and the header's links, which mark the section the visitor is in.
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { Browser } from './browser.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open()
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

const DESKTOP = { width: 1440, height: 900 }

// Each of the intro's buttons: its label, fill and text color.
const BUTTONS = `[...document.querySelectorAll('.ab-intro-actions .ab-btn')].map((b) => {
  const style = getComputedStyle(b)
  return { label: b.textContent.trim(), fill: style.backgroundColor, text: style.color }
})`

/** Moves the mouse to the middle of what `selector` finds, as a visitor pointing at it would. */
async function pointAt(selector: string) {
  const { x, y } = await browser.evaluate<{ x: number; y: number }>(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  })()`)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  return { x, y }
}

test('the intro’s three buttons share one look, and each turns ink as it is hovered or pressed', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  const white = 'rgb(255, 255, 255)'
  const ink = 'rgb(20, 20, 20)'
  assert.deepEqual(
    (await browser.evaluate<{ label: string; fill: string; text: string }[]>(BUTTONS)).map(
      ({ fill, text }) => ({ fill, text }),
    ),
    [1, 2, 3].map(() => ({ fill: white, text: ink })),
    'at rest',
  )
  for (const n of [1, 2, 3]) {
    const button = `.ab-intro-actions .ab-btn:nth-child(${n})`
    await pointAt(button)
    const hovered = await browser.evaluate<{ fill: string; text: string }>(
      `(({ backgroundColor, color }) => ({ fill: backgroundColor, text: color }))(getComputedStyle(document.querySelector('${button}')))`,
    )
    assert.deepEqual(hovered, { fill: ink, text: white }, `button ${n} hovered`)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 890 })
  }
  // Pressed, as on a touch screen, where nothing is hovered: the page's rule for it. (Pressed with
  // a mouse, a button is hovered too; moved away while held, a link starts being dragged.)
  const pressed = await browser.evaluate<string[]>(`[...document.styleSheets].flatMap((sheet) => {
    try { return [...sheet.cssRules] } catch { return [] }
  }).flatMap(function rules(rule) { return [rule, ...[...(rule.cssRules ?? [])].flatMap(rules)] })
    .filter((rule) => rule.selectorText?.split(',').some((s) => s.trim() === '.ab-intro-actions .ab-btn:active'))
    .map((rule) => rule.style.getPropertyValue('background') + ' / ' + rule.style.color)`)
  assert.deepEqual(pressed, ['var(--ink) / rgb(255, 255, 255)'], 'the rule for a pressed button')
})
