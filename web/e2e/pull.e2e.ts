// The pull machine when no title on the page may come out of it: spec §3G keeps Ecchi out of
// the pull. Its own file, so the doctored answers stay in a profile of their own.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { Browser } from './browser.ts'

/** Adds Ecchi to the genres of every title in an AniList answer. */
function tagEcchi(value: any): any {
  if (Array.isArray(value)) return value.map(tagEcchi)
  if (value === null || typeof value !== 'object') return value
  const copy = Object.fromEntries(Object.entries(value).map(([key, v]) => [key, tagEcchi(v)]))
  if (Array.isArray(copy.genres)) copy.genres = [...copy.genres, 'Ecchi']
  return copy
}

let browser: Browser
before(async () => {
  browser = await Browser.open()
  await browser.rewriteAniList(({ status, body }) => ({ status, body: tagEcchi(body) }))
  await browser.load()
})
after(() => browser?.close())

test('with nothing on the page it may hand out, the lever is off and the machine says why', async () => {
  assert.ok(await browser.titlesShown(), 'no titles on the page')
  const machine = await browser.evaluate<{ off: boolean; hint: string; capsules: number }>(`({
    off: document.querySelector('.ab-lever').disabled,
    hint: document.querySelector('.ab-hint')?.textContent ?? '',
    capsules: document.querySelectorAll('.ab-capsule').length,
  })`)
  assert.equal(machine.off, true, 'the lever can be pulled, but nothing would come out')
  assert.match(machine.hint, /another decade/)
  assert.equal(machine.capsules, 0, 'the dome shows titles that cannot come out')
})

test('the off lever looks off, and never tilts or swings', async () => {
  // The off lever used to look like a working one, and with motion allowed (as here) it tilted
  // on hover and swung on a press that pulls nothing. A working copy of it, put next to it for
  // a moment, shows what it must not look like, whatever the off look is.
  await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
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
