// The mood sliders on Discover's pull machine (Phase 5): what they say to a screen reader, a tap on
// a track, and what the machine keeps for the visit. Its own file, so its loads and the page
// script it plants stay in a profile of their own.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { AXES, type Axis } from '../src/features/mood/moods.ts'
import { Browser } from './browser.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open()
})
after(() => browser?.close())

const NEXT_FRAME =
  'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))'

/** The machine's mood slider named `label`, such as Energy, in page script. */
const slider = (label: string) =>
  `[...document.querySelectorAll('.ab-pull input[type="range"]')].find((input) => input.labels[0].textContent === '${label}')`

/** Sets the slider named `label` to `stop`, as a key or a drag sets it: its value, then input. */
function setSlider(label: string, stop: number) {
  return browser.evaluate(`(() => {
    const input = ${slider(label)}
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${stop}')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
}

/** What each slider shows and says: its name, its word on screen, and its aria-valuetext. */
const readSliders = () =>
  browser.evaluate<string[]>(
    `[...document.querySelectorAll('.ab-pull .ab-slider')].map((box) => { const input = box.querySelector('input'); return input.labels[0].textContent + ': ' + box.querySelector('.ab-slider-value').textContent + ' (heard as ' + input.getAttribute('aria-valuetext') + ')' })`,
  )

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

// Notes every focus() the page's own code calls on a range input, before the app runs: Safari on
// an iPhone mishandles a slider focused from code (WebKit bug 266283), so the app never does.
const FOCUS_SPY = `(() => {
  window.__focusedByCode = []
  const focus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (...args) {
    if (this instanceof HTMLInputElement && this.type === 'range') window.__focusedByCode.push(this.labels?.[0]?.textContent ?? 'a slider')
    return focus.apply(this, args)
  }
})()`

describe('the journey load', () => {
  before(async () => {
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: FOCUS_SPY })
    await browser.load({ reduceMotion: true })
    assert.ok(await browser.titlesShown(), 'no titles on the page')
  })

  test('on arrival no slider has focus, and each says the word for each of its stops, on screen and to a screen reader', async () => {
    const focused = await browser.evaluate<string>(
      `document.activeElement.matches('input[type="range"]') ? document.activeElement.labels[0].textContent : 'none'`,
    )
    const heard: Record<string, string[]> = {}
    for (const [axis, { label }] of Object.entries(AXES) as [Axis, (typeof AXES)[Axis]][]) {
      heard[axis] = []
      for (const stop of [-2, -1, 0, 1, 2]) {
        await setSlider(label, stop)
        await browser.evaluate(NEXT_FRAME)
        const line = (await readSliders()).find((read) => read.startsWith(`${label}:`))!
        heard[axis].push(line)
      }
      await setSlider(label, 0)
    }
    assert.deepEqual(
      { focused, heard },
      {
        focused: 'none',
        heard: Object.fromEntries(
          Object.entries(AXES).map(([axis, { label, words }]) => [
            axis,
            words.map((word) => `${label}: ${word} (heard as ${word})`),
          ]),
        ),
      },
    )
  })

  test('a quick tap on a slider’s track sets the stop under the finger, even where the browser would not', async () => {
    // A tap, not a drag (A5): Safari on an iPhone would only focus the slider. Chrome moves it to
    // the finger by itself, so here a touch's own action on a slider is cancelled, as Safari
    // gives none: the page's tap handler alone must set the stop. Each stop's dot sits where the
    // thumb's middle rests, from half the 40px thumb in at either end.
    const tapAt = async (label: string, stop: number) => {
      const at = await browser.evaluate<{ x: number; y: number }>(`(() => {
        const input = ${slider(label)}
        input.scrollIntoView({ block: 'center' })
        const r = input.getBoundingClientRect()
        return { x: r.left + 20 + ((r.width - 40) * (${stop} + 2)) / 4, y: r.top + r.height / 2 }
      })()`)
      await browser.evaluate(NEXT_FRAME)
      const now = Date.now() / 1000
      await browser.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [at],
        timestamp: now,
      })
      await browser.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
        timestamp: now + 0.08,
      })
      await browser.evaluate(NEXT_FRAME)
    }
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await browser.evaluate(`(() => {
      window.__noTouchAction = (event) => event.target.matches?.('input[type="range"]') && event.preventDefault()
      addEventListener('touchstart', window.__noTouchAction, { capture: true, passive: false })
      return true
    })()`)
    try {
      await tapAt('Energy', -2)
      await tapAt('Tone', 2)
      await tapAt('Complexity', 1)
    } finally {
      await browser.evaluate(
        `removeEventListener('touchstart', window.__noTouchAction, { capture: true }), true`,
      )
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    }
    assert.deepEqual(await readSliders(), [
      'Energy: Very cozy (heard as Very cozy)',
      'Tone: Very dark (heard as Very dark)',
      'Complexity: Cerebral (heard as Cerebral)',
    ])
    await browser.evaluate(`document.querySelector('.ab-reset').click(); true`)
    assert.deepEqual(
      await browser.evaluate(
        `[...document.querySelectorAll('.ab-pull input[type="range"]')].map((input) => input.value)`,
      ),
      ['0', '0', '0'],
      'Reset moods left a slider set',
    )
  })

  test('a slider set and 3 pulls are kept through a visit to My List: the slider still reads its word, and none of the 3 comes back in the next pulls', async () => {
    await setSlider('Energy', -2)
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    const first = await pulls(3)
    assert.equal(first.filter(Boolean).length, 3, 'pulls that never opened')
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
    const back = {
      energy: (await readSliders())[0],
      count: await browser.evaluate<string>(`document.querySelector('.ab-count').textContent`),
      shown: await browser.evaluate<string | null>(
        `document.querySelector('.ab-result-panel')?.getAttribute('href') ?? null`,
      ),
    }
    // With Math.random at 0, each pull takes the best match not pulled lately: a machine that
    // forgot the 3 would give the first of them again.
    const next = await pulls(6)
    assert.deepEqual(
      { ...back, again: next.filter((href) => first.includes(href)) },
      {
        energy: 'Energy: Very cozy (heard as Very cozy)',
        count: '3 pulls this visit',
        shown: first[2],
        again: [],
      },
    )
    await browser.evaluate(`document.querySelector('.ab-reset').click(); true`)
  })

  test('the page’s code never focuses a slider', async () => {
    assert.deepEqual(await browser.evaluate('window.__focusedByCode'), [])
  })
})
