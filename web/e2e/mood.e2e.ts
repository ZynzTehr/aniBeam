// The mood sliders on Discover's pull machine (Phase 5): what they say to a screen reader, a tap on
// a track, what the machine keeps for the visit, and what it asks AniList for: its decade's mood
// pool, only once wanted (the plan's section 2). Its own file, so its loads and the page script it
// plants stay in a profile of their own.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { titleOf } from '../src/features/anime/format.ts'
import { cardOf, ERAS, poolOf, QUERIES, type Media } from '../src/features/anime/queries.ts'
import { MOOD_TAGS } from '../src/features/mood/moodMap.ts'
import {
  AXES,
  fewLine,
  LISTED,
  REPEATS,
  samplesLine,
  type Axis,
  type Stop,
} from '../src/features/mood/moods.ts'
import { FEW, NEED_MORE, pullable } from '../src/features/mood/roll.ts'
import { rankMatches, whyOf } from '../src/features/mood/score.ts'
import { accentVars } from '../src/features/theming/deriveAccent.ts'
import { BASE_URL, Browser, poll } from './browser.ts'
import { askedFor, listsOf, recordedPage3, recordedPool, recordings } from './recordings.ts'

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
 * Pulls `times` in page script with Math.random fixed at `random`, 0 unless given, each once the
 * last has opened (at once, under reduced motion), and gives each pulled title's address, or null
 * for a pull that never opened.
 */
function pulls(times: number, random = 0) {
  return browser.evaluate<(string | null)[]>(`(async () => {
    const random = Math.random
    Math.random = () => ${random}
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

/**
 * Whether the page's saved copy holds the mood pool of the decade `id`: it is saved within a
 * second of arriving, after the machine has it.
 */
const poolSaved = (id: string) =>
  `(JSON.parse(localStorage.getItem('anibeam:cache'))?.clientState.queries ?? []).some((query) => query.queryKey[1] === ${JSON.stringify(QUERIES.pool)} && JSON.stringify(query.queryKey[2]) === ${JSON.stringify(JSON.stringify(ERAS.find((era) => era.id === id)!.variables))} && query.state.data)`

/**
 * Whether the page's saved copy holds the decade `id`'s mood pool's page 3 (poolPage3Query): it is
 * saved, as the pool is, within a second of arriving.
 */
const page3Saved = (id: string) =>
  `(JSON.parse(localStorage.getItem('anibeam:cache'))?.clientState.queries ?? []).some((query) => query.queryKey[1] === ${JSON.stringify(QUERIES.poolPage3)} && JSON.stringify(query.queryKey[2]) === ${JSON.stringify(JSON.stringify(ERAS.find((era) => era.id === id)!.variables))} && query.state.data)`

/** The machine's top matches: each one's address and its Why line, in order. */
const MATCHES = `[...document.querySelectorAll('.ab-pull .ab-match[href]')].map((link) => link.getAttribute('href') + ' ' + link.querySelector('.ab-match-why').textContent)`

/** Each stop of the three sliders together, Energy's first: 125 settings. */
const STOPS: Stop[] = [-2, -1, 0, 1, 2]
const SETTINGS = STOPS.flatMap((energy) =>
  STOPS.flatMap((tone) => STOPS.map((complexity) => ({ energy, tone, complexity }))),
)

/**
 * Moves the three sliders through each of `settings` in page script, as keys or drags would,
 * each once the last has been drawn, calling `read` (page script, given the setting) after each
 * draw, and puts them back at no preference. Gives what each read gave.
 */
function eachSetting<T>(settings: Record<Axis, Stop>[], read: string) {
  return browser.evaluate<T[]>(`(async () => {
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const inputs = [...document.querySelectorAll('.ab-pull input[type="range"]')]
    const set = (stops) => stops.forEach((stop, i) => {
      if (inputs[i].value === String(stop)) return
      value.call(inputs[i], String(stop))
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }))
    })
    const read = ${read}
    const seen = []
    for (const setting of ${JSON.stringify(settings)}) {
      set([setting.energy, setting.tone, setting.complexity])
      await ${NEXT_FRAME}
      seen.push(read(setting))
    }
    set([0, 0, 0])
    await ${NEXT_FRAME}
    return seen
  })()`)
}

/**
 * Every request the page asks AniList's API for from now on, by Chrome's own log of the page's
 * requests (Network.requestWillBeSent), whatever answers it: its method, POST. Chrome's CORS
 * preflight before a POST is left out, a question about the POST, not one of its own.
 */
async function watchAniList() {
  const asked: string[] = []
  browser.onEvent('Network.requestWillBeSent', ({ request }) => {
    if (request.url.startsWith('https://graphql.anilist.co') && request.method !== 'OPTIONS')
      asked.push(request.method)
  })
  await browser.send('Network.enable')
  return asked
}

/**
 * Walks each slider by keyboard from the machine's heading: Tab to it, Home, then the right arrow
 * to each stop, End and Home again. Gives what a screen reader heard at each stop.
 */
async function everyStopByKeyboard() {
  await browser.evaluate(`document.getElementById('pull').focus(); true`)
  const heard: string[] = []
  const hear = () =>
    browser.evaluate<string>(
      `document.activeElement.labels[0].textContent + ': ' + document.activeElement.getAttribute('aria-valuetext')`,
    )
  for (let slider = 0; slider < 3; slider++) {
    await browser.press('Tab')
    for (const key of [
      'Home',
      'ArrowRight',
      'ArrowRight',
      'ArrowRight',
      'ArrowRight',
      'End',
      'Home',
    ] as const) {
      await browser.press(key)
      heard.push(await hear())
    }
  }
  return heard
}

/** What everyStopByKeyboard() hears: each slider's words, its ends twice. */
const EVERY_STOP = Object.values(AXES).flatMap(({ label, words }) =>
  [...words, words[4], words[0]].map((word) => `${label}: ${word}`),
)

/** Leaves the tab and comes back, as the page hears it: hidden, then shown and focused again. */
const awayAndBack = `(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  delete document.visibilityState
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  window.dispatchEvent(new Event('focus'))
  return document.visibilityState
})()`

// The 1990s' and the 1980s' first days, as their requests ask from them.
const FIRST_POOL_FROM = ERAS.find((era) => era.id === '1990s')!.variables.from
const EIGHTIES_FROM = ERAS.find((era) => era.id === '1980s')!.variables.from
// The 1980s' most popular title, the first in their strip.
const EIGHTIES_FIRST = listsOf(recordings().get('era-1980s')!).Page[0].id

// How long a check waits to see that nothing more is asked for: a request any step made would
// have gone within a few frames.
const QUIET_MS = 500

/**
 * Puts the titles `ids` on My List, or takes them off with `on` false, as a write from another tab
 * reaches the page: saved, then the storage event.
 */
function setList(ids: number[], on = true) {
  return browser.evaluate(`(() => {
    const now = Date.now()
    const json = JSON.stringify(Object.fromEntries(${JSON.stringify(ids)}.map((id) => [id, { status: 'SAVED', favorite: false, updatedAt: now${on ? '' : ', deleted: true'} }])))
    localStorage.setItem('anibeam:list:v1', json)
    dispatchEvent(new StorageEvent('storage', { key: 'anibeam:list:v1', newValue: json }))
    return true
  })()`)
}

/**
 * Rolls `times` in page script with Math.random at 0, each once the status line has said the last
 * (waiting on the line, never on a time), and gives what it said and the rolled title's address.
 */
function rollsSaid(times: number) {
  return browser.evaluate<{ said: string; href: string | null }[]>(`(async () => {
    const random = Math.random
    Math.random = () => 0
    const line = document.querySelector('.ab-pull > [role="status"]')
    const rolled = []
    try {
      for (let i = 0; i < ${times}; i++) {
        const before = line.textContent
        const said = new Promise((resolve) => {
          const watch = new MutationObserver(() => {
            if (line.textContent && line.textContent !== before) resolve(watch.disconnect())
          })
          watch.observe(line, { childList: true, characterData: true, subtree: true })
          setTimeout(() => resolve(watch.disconnect()), 5000)
        })
        document.querySelector('.ab-lever').click()
        await said
        rolled.push({ said: line.textContent, href: document.querySelector('.ab-result.is-open .ab-result-panel')?.getAttribute('href') ?? null })
      }
    } finally {
      Math.random = random
    }
    return rolled
  })()`)
}

/**
 * Which show each title of `pool` belongs to: titles linked by their seasons, one to the next,
 * even through a title outside the pool, are one show. Gives a title's show by its id.
 */
function showsOf(pool: { id: number; seasons: number[] }[]) {
  const links = new Map<number, number[]>()
  for (const { id, seasons } of pool)
    for (const other of seasons) {
      links.set(id, [...(links.get(id) ?? []), other])
      links.set(other, [...(links.get(other) ?? []), id])
    }
  const show = new Map<number, number>()
  for (const { id } of pool) {
    if (show.has(id)) continue
    const linked = [id]
    show.set(id, id)
    for (const one of linked)
      for (const other of links.get(one) ?? [])
        if (!show.has(other)) {
          show.set(other, id)
          linked.push(other)
        }
  }
  return (id: number) => show.get(id) ?? id
}

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

  test('once the pool is in, every stop of every slider by keyboard, Reset moods, a match’s card opened and closed, and leaving the tab and coming back send AniList nothing, by Chrome’s own log', async () => {
    // The spec's goal: a mood slider moved makes 0 requests once the pool is cached (done-when 1).
    assert.ok(await browser.waitFor(poolSaved('1990s')), 'the pool never arrived')
    const requests = await watchAniList()
    const heard = await everyStopByKeyboard()
    // Reset moods, by keyboard: it hands focus on to the lever, and Tab then reaches the first
    // match, whose card Enter opens and Escape closes.
    await browser.press('Tab')
    const reset = await browser.evaluate<string>('document.activeElement.textContent')
    await browser.press('Enter')
    await browser.press('Tab')
    const match = await browser.evaluate<string>(
      `document.activeElement.matches('.ab-match') ? 'a match' : document.activeElement.textContent`,
    )
    await browser.press('Enter')
    const opened = await browser.waitFor(`document.querySelector('dialog.ab-card[open]')`, 5_000)
    await browser.press('Escape')
    const closed = await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5_000)
    const back = await browser.evaluate<string>(awayAndBack)
    await sleep(QUIET_MS)
    assert.deepEqual(
      {
        heard,
        reset,
        sliders: await browser.evaluate(
          `[...document.querySelectorAll('.ab-pull input[type="range"]')].map((input) => input.value).join(' ')`,
        ),
        match,
        opened,
        closed,
        back,
        asked: requests,
      },
      {
        heard: EVERY_STOP,
        reset: 'Reset moods',
        sliders: '0 0 0',
        match: 'a match',
        opened: true,
        closed: true,
        back: 'visible',
        asked: [],
      },
    )
    await browser.evaluate('document.activeElement.blur(); true')
  })

  test('at No preference the top 3 are the 1990s’ most popular, under “Most popular in the 1990s”, and at Very cozy Only Yesterday comes first, why named', async () => {
    const pool = recordedPool('1990s').titles
    assert.ok(await browser.waitFor(poolSaved('1990s')), 'the pool never arrived')
    await browser.evaluate(NEXT_FRAME)
    const read = () =>
      browser.evaluate<{
        heading: string
        words: string
        matches: string[]
        dome: string[]
      }>(`(() => {
        const words = document.querySelector('.ab-pull .ab-set')
        return {
          heading: document.querySelector('.ab-pull .ab-matches h3').textContent,
          words: getComputedStyle(words).visibility === 'visible' ? words.textContent : '',
          matches: ${MATCHES},
          dome: [...document.querySelectorAll('.ab-pull .ab-capsule')].map((capsule) => capsule.style.getPropertyValue('--anime-accent')),
        }
      })()`)
    // The dome's 9 capsules in the colors of the 9 best matches, in their order.
    const dome = (titles: readonly Media[]) =>
      titles
        .slice(0, 9)
        .map(
          (media) =>
            (accentVars(media.coverImage.color) as Record<string, string>)['--anime-accent'],
        )
    const rest = await read()
    await setSlider('Energy', -2)
    await browser.evaluate(NEXT_FRAME)
    const cozy = await read()
    await setSlider('Energy', 0)
    const sliders = { energy: -2, tone: 0, complexity: 0 } as const
    const top = rankMatches(pool, sliders).slice(0, 3)
    assert.deepEqual(
      { rest, cozy, first: titleOf(top[0]) },
      {
        rest: {
          heading: 'Most popular in the 1990s',
          words: '',
          matches: pool.slice(0, 3).map(({ id }) => `/anime/${id} `),
          dome: dome(pool),
        },
        cozy: {
          heading: 'Top matches',
          words: 'Very cozy',
          matches: top.map(
            (media) => `/anime/${media.id} Why: ${whyOf(media, sliders).join(' · ')}`,
          ),
          dome: dome(rankMatches(pool, sliders)),
        },
        first: 'Only Yesterday',
      },
    )
  })

  test('at every setting of the three sliders, the top 3 are the pool’s best matches, and no Why line names a spoiler tag', async () => {
    const pool = recordedPool('1990s').titles
    const byId = new Map(pool.map((media) => [media.id, media]))
    const seen = await eachSetting<string[]>(SETTINGS, `() => ${MATCHES}`)
    const spoilers = seen.flatMap((matches, i) =>
      matches.flatMap((match) => {
        const space = match.indexOf(' ')
        const media = byId.get(Number(match.slice(0, space).split('/').pop()))!
        const names = match
          .slice(space + 1)
          .replace(/^Why: /, '')
          .split(' · ')
        return media.tags
          .filter((tag) => (tag.isGeneralSpoiler || tag.isMediaSpoiler) && names.includes(tag.name))
          .map((tag) => `${JSON.stringify(SETTINGS[i])}: ${titleOf(media)}, ${tag.name}`)
      }),
    )
    const expected = SETTINGS.map((sliders) =>
      rankMatches(pool, sliders)
        .slice(0, 3)
        .map((media) => {
          const names = whyOf(media, sliders)
          return `/anime/${media.id} ${names.length ? `Why: ${names.join(' · ')}` : ''}`
        }),
    )
    assert.deepEqual(spoilers, [], 'a Why line named a spoiler tag')
    assert.deepEqual(seen, expected)
  })

  test('moving the sliders moves nothing on the page, at 1440 and at 390', async () => {
    // Every 7th setting of the three sliders, so the heading, the set words, the matches and their
    // Why lines all change. A shift a script's change makes counts, as no visitor's input came
    // before it.
    const settings = SETTINGS.filter((_, i) => i % 7 === 0)
    const moved: Record<string, string[]> = {}
    for (const [width, height, phone] of [
      [1440, 900, false],
      [390, 844, true],
    ] as const) {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: phone ? 2 : 1,
        mobile: phone,
      })
      await browser.evaluate(
        `document.querySelector('.ab-pull .ab-matches').scrollIntoView({ block: 'center' }), true`,
      )
      await browser.evaluate(NEXT_FRAME)
      // Each shift's parts, named as it is seen, but a slider's own word, which follows the
      // visitor's key or finger: a shift so soon after their input is not counted.
      await browser.evaluate(`(() => {
        window.__shifts = []
        const name = (source) => {
          const node = source.node?.nodeType === 3 ? source.node.parentElement : source.node
          if (node?.closest('.ab-slider')) return []
          return [(node ? node.className || node.nodeName : 'a part gone') + ' by ' + Math.round(source.currentRect.left - source.previousRect.left) + ', ' + Math.round(source.currentRect.top - source.previousRect.top) + 'px']
        }
        window.__note = (entries) => entries.forEach((shift) => window.__shifts.push(...shift.sources.flatMap(name)))
        window.__shiftWatch = new PerformanceObserver((list) => window.__note(list.getEntries()))
        window.__shiftWatch.observe({ type: 'layout-shift' })
        return true
      })()`)
      await eachSetting(settings, '() => 0')
      moved[width] = await browser.evaluate<string[]>(`(() => {
        window.__note(window.__shiftWatch.takeRecords())
        window.__shiftWatch.disconnect()
        return window.__shifts
      })()`)
    }
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    assert.deepEqual(moved, { 1440: [], 390: [] })
  })

  test('every line the machine can say fits the room kept for it at 390 and at 320, so none moves the matches', async () => {
    // The room is kept whichever line shows, and none may outgrow it: AniList's busy line, which
    // comes and goes with no input of the visitor's, took a third line on a phone.
    const longest = Object.values(AXES).map(({ words }) =>
      words.reduce((one, other) => (other.length > one.length ? other : one)),
    )
    const lines = [
      'The mood scoring didn’t load.',
      'Offline: waiting for a connection.',
      samplesLine(5),
      'AniList is busy right now. It’s not something you did. Trying again within a minute.',
      'Filling the machine…',
      REPEATS,
      fewLine(FEW - 1),
      LISTED,
      longest.join(' · '),
    ]
    const over: string[] = []
    for (const [width, height] of [
      [390, 844],
      [320, 568],
    ] as const) {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 2,
        mobile: true,
      })
      // Each line in a copy of the line's box, beside it: the room an empty line keeps, first.
      const heights = await browser.evaluate<number[]>(`(() => {
        const line = document.querySelector('.ab-pull .ab-set')
        return ['', ...${JSON.stringify(lines)}].map((text) => {
          const copy = line.cloneNode()
          copy.textContent = text
          line.after(copy)
          const height = copy.getBoundingClientRect().height
          copy.remove()
          return height
        })
      })()`)
      lines.forEach((line, i) => {
        if (heights[i + 1] > heights[0])
          over.push(`${width}: “${line}” takes ${heights[i + 1]}px, its room ${heights[0]}px`)
      })
    }
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    assert.deepEqual(over, [])
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
    // With it at 0.99, a pull takes the last of the 12 best matches not pulled lately (A12): an
    // unwindowed pull would reach far past them.
    const [far] = await pulls(1, 0.99)
    const sliders = { energy: -2, tone: 0, complexity: 0 } as const
    const lately = new Set([...first, ...next])
    const best = pullable(rankMatches(recordedPool('1990s').titles, sliders))
      .filter(({ id }) => !lately.has(`/anime/${id}`))
      .slice(0, 12)
    assert.deepEqual(
      { ...back, again: next.filter((href) => first.includes(href)), far },
      {
        energy: 'Energy: Very cozy (heard as Very cozy)',
        count: '3 rolls this visit',
        shown: first[2],
        again: [],
        far: `/anime/${best[11].id}`,
      },
    )
    await browser.evaluate(`document.querySelector('.ab-reset').click(); true`)
  })

  test('the pulled title’s rays leave the matches’ heading clear, on laptops, tablets and a phone', async () => {
    // The user's ask: the rays behind the pulled title reached over "Most popular in the 1990s" on
    // laptops and tablets, where the matches sit beside the machine. The heading's box is shot
    // with the rays and with them hidden: a pixel that differs is a ray over the heading.
    const over: string[] = []
    for (const [width, height, scale] of [
      [1440, 900, 1],
      [1280, 800, 1],
      [1024, 768, 1],
      [834, 1112, 2],
      [768, 1024, 2],
      [390, 844, 2],
    ] as const) {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: scale > 1,
      })
      const [pulled] = await pulls(1)
      assert.ok(pulled, `at ${width}px the pull never opened`)
      await browser.evaluate(
        `document.querySelector('.ab-pull .ab-matches').scrollIntoView({ block: 'center' }), true`,
      )
      await browser.evaluate(NEXT_FRAME)
      const clip = await browser.evaluate<{ x: number; y: number; width: number; height: number }>(
        `(() => { const box = document.querySelector('.ab-pull .ab-matches h3').getBoundingClientRect(); return { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height } })()`,
      )
      const rays = `document.querySelector('.ab-result.is-open .ab-burst').style.visibility`
      const shown = await browser.screenshot(clip)
      await browser.evaluate(`${rays} = 'hidden'; true`)
      const hidden = await browser.screenshot(clip)
      await browser.evaluate(`${rays} = ''; true`)
      // Compared in the page, as the pixels are many.
      const changed = await browser.evaluate<number>(`(async () => {
        const pixels = async (png) => {
          const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
          const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
          const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
          context.drawImage(image, 0, 0)
          return context.getImageData(0, 0, image.width, image.height).data
        }
        const [a, b] = await Promise.all([pixels(${JSON.stringify(shown)}), pixels(${JSON.stringify(hidden)})])
        let changed = 0
        for (let i = 0; i < a.length; i += 4)
          if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed++
        return changed
      })()`)
      if (changed)
        over.push(`${width}px: the rays change ${changed / scale ** 2} px of the heading’s box`)
    }
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    assert.deepEqual(over, [])
  })

  test('the page’s code never focuses a slider', async () => {
    assert.deepEqual(await browser.evaluate('window.__focusedByCode'), [])
  })

  test('20 rolls at Very cozy give 20 different titles, none of the 2 on My List, no two seasons of one show, each said as it lands, asking AniList nothing', async () => {
    // Done-when (2). Math.random is at 0, so each roll takes the best match left, the same every
    // run: a roll that skipped no season would give Digimon's movie (12th at Very cozy) and its
    // series (15th) both. The two titles put on My List are the next two best.
    const pool = recordedPool('1990s').titles
    const best = rankMatches(pool, { energy: -2, tone: 0, complexity: 0 })
    const listed = [best[9].id, best[10].id]
    await setList(listed)
    await setSlider('Energy', -2)
    assert.ok(await browser.waitFor(poolSaved('1990s')), 'the pool never arrived')
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    const requests = await watchAniList()
    const rolled = await rollsSaid(20)
    await sleep(QUIET_MS)
    await setList(listed, false)
    await setSlider('Energy', 0)
    const ids = rolled.map(({ href }) => Number(href?.split('/').pop()))
    const show = showsOf(pool)
    const first = Number(/^Roll (\d+):/.exec(rolled[0].said)?.[1])
    assert.deepEqual(
      {
        different: new Set(ids).size,
        listed: ids.filter((id) => listed.includes(id)),
        sameShow: ids.filter((id, i) => ids.slice(0, i).some((other) => show(other) === show(id))),
        said: rolled.map(({ said }) => said.replace(/, (SSR|SR|R|Mystery)\.$/, '.')),
        asked: requests,
      },
      {
        different: 20,
        listed: [],
        sameShow: [],
        said: ids.map((id, i) => {
          const media = pool.find((other) => other.id === id)
          return `Roll ${first + i}: ${media ? titleOf(media) : `a title not in the pool, ${id}`}.`
        }),
        asked: [],
      },
    )
    assert.ok(first > 0, `the first roll said “${rolled[0].said}”`)
  })

  /**
   * Puts every title of the 1990s' pool and of its page 3 on My List but `left`, with page 3 in,
   * and gives the ids listed. A roll that leaves fewer than 10 titles to come up asks for page 3
   * (the plan's A12), whose titles would then come up: so, while it isn't in, one roll is made
   * with only one other title left, and page 3 awaited, every title of it listed too.
   */
  async function leaveOnly(left: number[]) {
    const pool = recordedPool('1990s').titles
    const all = [...new Set([...pool, ...recordedPage3('1990s')].map(({ id }) => id))]
    if (!(await browser.evaluate<boolean>(page3Saved('1990s')))) {
      const other = pool.find(({ id }) => !left.includes(id))!.id
      await setList(all.filter((id) => id !== other))
      await browser.evaluate(NEXT_FRAME)
      // That roll leaves none to come up, but page 3's titles are on their way: no repeats yet.
      const [{ said }] = await rollsSaid(1)
      assert.ok(!said.endsWith(REPEATS), `the roll that asked for page 3 said “${said}”`)
      assert.ok(await browser.waitFor(page3Saved('1990s')), 'page 3 never arrived')
    }
    // A write from another tab adds to what the page holds, so `left` are taken off on their own.
    const listed = all.filter((id) => !left.includes(id))
    await setList(listed)
    await setList(left, false)
    await browser.evaluate(NEXT_FRAME)
    return listed
  }

  test('with every title left rolled lately, the line says repeats start now, and they come back the oldest first', async () => {
    // Three titles no roll has come near (the least popular, far from Very cozy's best) are all
    // that is left off My List: three rolls, then the repeats, the first rolled first. The
    // machine holds the whole decade, page 3 too, so the line first counts the titles left down.
    const pool = recordedPool('1990s').titles
    const cozy = new Set(
      rankMatches(pool, { energy: -2, tone: 0, complexity: 0 })
        .slice(0, 45)
        .map(({ id }) => id),
    )
    const left = pool.filter(({ id }) => !cozy.has(id)).slice(-3)
    const listed = await leaveOnly(left.map(({ id }) => id))
    const line = `document.querySelector('.ab-pull .ab-set').textContent`
    const before = await browser.evaluate<string>(line)
    const rolled = []
    for (let i = 0; i < 5; i++) {
      const [roll] = await rollsSaid(1)
      rolled.push({ ...roll, line: await browser.evaluate<string>(line) })
    }
    await setList(listed, false)
    const titleAt = (href: string | null) =>
      titleOf(pool.find(({ id }) => `/anime/${id}` === href) ?? left[0])
    const three = rolled.slice(0, 3).map(({ href }) => href)
    assert.deepEqual(
      {
        before,
        three: [...three].sort(),
        hrefs: rolled.map(({ href }) => href),
        lines: rolled.map(({ line }) => line),
        said: rolled.map(({ said }) =>
          said.replace(/^Roll \d+: /, '').replace(/, (SSR|SR|R|Mystery)\./, ','),
        ),
      },
      {
        before: fewLine(3),
        three: left.map(({ id }) => `/anime/${id}`).sort(),
        hrefs: [...three, three[0], three[1]],
        lines: [fewLine(2), fewLine(1), REPEATS, REPEATS, REPEATS],
        // Each roll says the line as it leaves it, once.
        said: rolled.map(({ href, line }) => `${titleAt(href)}, ${line}`),
      },
    )
  })

  test('Save on the rolled card puts it on My List, and none of the next 30 rolls gives it, with 2 others left; the card’s buttons keep their names, and its Roll again keeps its focus', async () => {
    // The plan's PR 4, commit 6. Three titles are left off My List: the rolled one, once saved,
    // would be the first to come back as the other two repeat, were it not on My List.
    const pool = recordedPool('1990s').titles
    const cozy = new Set(
      rankMatches(pool, { energy: -2, tone: 0, complexity: 0 })
        .slice(0, 45)
        .map(({ id }) => id),
    )
    const left = pool.filter(({ id }) => !cozy.has(id)).slice(-3)
    const listed = await leaveOnly(left.map(({ id }) => id))
    // Every title of the page is on My List now, so the machine asks for its pool, if it hasn't.
    assert.ok(
      await browser.waitFor(
        `${poolSaved('1990s')} && !document.querySelector('.ab-lever').disabled`,
      ),
      'the pool never arrived',
    )
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    const names = `[document.querySelector('.ab-lever'), ...document.querySelectorAll('.ab-result:not([data-old]) button')].map((button) => button.getAttribute('aria-label') ?? button.textContent.trim())`
    const [{ href }] = await rollsSaid(1)
    const saved = Number(href?.split('/').pop())
    const before = await browser.evaluate<string[]>(names)
    await browser.evaluate(
      `[...document.querySelectorAll('.ab-result button')].find((button) => button.textContent.trim() === 'Save').click(); true`,
    )
    const entry = await browser.evaluate<{ status: string } | null>(
      `JSON.parse(localStorage.getItem('anibeam:list:v1'))?.[${saved}] ?? null`,
    )
    const pressed = await browser.evaluate<string | null>(
      `[...document.querySelectorAll('.ab-result button')].find((button) => button.textContent.trim() === 'Save').getAttribute('aria-pressed')`,
    )
    const afterSave = await browser.evaluate<string[]>(names)
    // Roll again, by keyboard: the card is drawn again for the new title, and its Roll again takes
    // the focus the last one had.
    await browser.evaluate(`(() => {
      const again = [...document.querySelectorAll('.ab-result button')].find((button) => button.textContent.trim() === 'Roll again')
      document.querySelector('.ab-result').setAttribute('data-old', '')
      again.focus()
      return true
    })()`)
    await browser.press('Space')
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-result.is-open:not([data-old])')`, 5000),
      'Roll again rolled nothing',
    )
    const focus = await browser.evaluate<string>(
      `(() => { const focused = document.activeElement; return focused?.closest('.ab-result:not([data-old])') ? 'the new card’s ' + focused.textContent.trim() : focused === document.body ? 'nothing' : (focused?.getAttribute('aria-label') ?? focused?.textContent.trim()) })()`,
    )
    const afterAgain = await browser.evaluate<string[]>(names)
    const next = [
      await browser.evaluate<string>(
        `document.querySelector('.ab-result.is-open .ab-result-panel').getAttribute('href')`,
      ),
      ...(await rollsSaid(29)).map((roll) => roll.href),
    ]
    await setList([...listed, saved], false)
    const card = ['Save', 'Want to try', 'Favorite', 'Details', 'Roll again']
    assert.deepEqual(
      {
        entry: entry?.status,
        pressed,
        before,
        afterSave,
        afterAgain,
        focus,
        rolls: next.length,
        again: next.filter((other) => other === href),
        others: [...new Set(next)].sort(),
      },
      {
        entry: 'SAVED',
        pressed: 'true',
        before: ['Roll a random anime', ...card],
        afterSave: ['Roll a random anime', ...card],
        afterAgain: ['Roll a random anime', ...card],
        focus: 'the new card’s Roll again',
        rolls: 30,
        again: [],
        others: left
          .map(({ id }) => `/anime/${id}`)
          .filter((other) => other !== href)
          .sort(),
      },
    )
  })

  test('Details on the rolled card opens its title card, and closing it gives Details its focus back', async () => {
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    const [{ href }] = await rollsSaid(1)
    await browser.evaluate(
      `[...document.querySelectorAll('.ab-result button')].find((button) => button.textContent.trim() === 'Details').focus(); true`,
    )
    await browser.press('Space')
    assert.ok(
      await browser.waitFor(`document.querySelector('dialog.ab-card[open]')`, 5000),
      'Details opened no title card',
    )
    const opened = await browser.evaluate<string>(
      `document.getElementById('ab-card-title').textContent.trim()`,
    )
    await browser.press('Escape')
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000),
      'Esc never closed the title card',
    )
    const media = recordedPool('1990s').titles.find(({ id }) => `/anime/${id}` === href)
    assert.deepEqual(
      {
        opened,
        focus: await browser.evaluate<string>(
          `document.activeElement.closest('.ab-result') ? 'the card’s ' + document.activeElement.textContent.trim() : document.activeElement.localName`,
        ),
      },
      {
        opened: media ? titleOf(media) : `a title not in the pool, ${href}`,
        focus: 'the card’s Details',
      },
    )
  })
})

describe('a cold first visit, counted', () => {
  // Every request the page makes from its navigation on, by what it asks for (see askedFor).
  const asked: string[] = []
  before(async () => {
    await browser.forget()
    await browser.rewriteAniList(({ request }) => {
      asked.push(askedFor(request))
      return null
    })
    await browser.load({ reduceMotion: true })
    assert.ok(await browser.titlesShown(), 'no titles on the page')
  })
  after(() => browser.rewriteAniList(null))

  test('sends exactly 1 request, and scrolling through the machine, a Tab walk through it and 5 pulls with no slider set send none', async () => {
    for (const section of ['pull', 'decades', 'pull']) {
      await browser.evaluate(`document.getElementById('${section}').scrollIntoView(); true`)
      await browser.evaluate(NEXT_FRAME)
    }
    // From the machine's heading: the three sliders, the lever, its top 3, then the decades.
    await browser.evaluate(`document.getElementById('pull').focus(); true`)
    const walked: string[] = []
    for (let stop = 0; stop < 8; stop++) {
      await browser.press('Tab')
      walked.push(
        await browser.evaluate<string>(
          `document.activeElement.matches('.ab-match') ? 'a match' : document.activeElement.labels?.[0]?.textContent ?? document.activeElement.textContent`,
        ),
      )
    }
    const pulled = await pulls(5)
    await sleep(QUIET_MS)
    assert.deepEqual(
      { walked, pulled: pulled.filter(Boolean).length, asked },
      {
        walked: ['Energy', 'Tone', 'Complexity', 'Roll!', 'a match', 'a match', 'a match', '1990s'],
        pulled: 5,
        asked: ['first visit'],
      },
    )
    await browser.evaluate('document.activeElement.blur(); true')
  })

  test('a press on a slider then sends exactly 1 more, the 1990s pool, before the press ends', async () => {
    // A mouse press on Energy's thumb, at no preference, which moves nothing.
    const at = await browser.evaluate<{ x: number; y: number }>(`(() => {
      const input = ${slider('Energy')}
      input.scrollIntoView({ block: 'center' })
      const r = input.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await browser.evaluate(NEXT_FRAME)
    const mouse = { ...at, button: 'left', clickCount: 1 } as const
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouse })
    const during = await poll(async () => asked.length > 1, 10_000)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouse })
    assert.ok(during, 'no request while the press lasted')
    assert.ok(await browser.waitFor(poolSaved('1990s')), 'the pool never arrived')
    await sleep(QUIET_MS)
    assert.deepEqual(
      { energy: (await readSliders())[0], asked },
      {
        energy: 'Energy: No preference (heard as No preference)',
        asked: ['first visit', 'pool 1990s'],
      },
    )
  })

  test('with a slider set, picking the 1980s with the machine on screen costs exactly 1 request, its titles and its pool together, the 1990s’ matches staying under “Filling the machine…” meanwhile, the machine then shows and pulls titles of the 1980s, and going back to the 1990s and moving the sliders costs none and shows theirs', async () => {
    const eighties = poolOf(recordings().get('era-pool-1980s')!.body.data, MOOD_TAGS).titles.map(
      ({ id }) => `/anime/${id}`,
    )
    const ninetiesPool = recordedPool('1990s').titles.map(({ id }) => `/anime/${id}`)
    const matched = () =>
      browser.evaluate<string[]>(
        `[...document.querySelectorAll('.ab-pull .ab-match[href]')].map((link) => link.getAttribute('href'))`,
      )
    await setSlider('Energy', -2)
    // The matches on screen as the decade changes: a pool held there would keep the 1990s'.
    await browser.evaluate(
      `document.querySelector('.ab-pull .ab-matches').scrollIntoView({ block: 'center' }); true`,
    )
    await browser.evaluate(NEXT_FRAME)
    const before = await matched()
    // Its answer held a moment, to see the machine while it loads.
    await browser.holdAniList(1_500)
    await browser.evaluate(`document.querySelector('.ab-eras input[value="1980s"]').click(); true`)
    assert.ok(await poll(async () => asked.length > 2, 10_000), 'picking the 1980s asked nothing')
    const during = {
      matches: await matched(),
      line: await browser.evaluate<string>(
        `document.querySelector('.ab-pull .ab-set').textContent`,
      ),
    }
    await browser.holdAniList(0)
    assert.ok(await browser.waitFor(poolSaved('1980s')), 'the 1980s’ pool never arrived')
    await browser.evaluate(NEXT_FRAME)
    const shown = await matched()
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    const [pulled] = await pulls(1)
    await browser.evaluate(
      `document.querySelector('.ab-pull .ab-matches').scrollIntoView({ block: 'center' }); true`,
    )
    await browser.evaluate(NEXT_FRAME)
    await browser.evaluate(`document.querySelector('.ab-eras input[value="1990s"]').click(); true`)
    // The 1990s' titles back in the strip, from the cache.
    const nineties = listsOf(recordings().get('first-visit')!).era.map(cardOf)
    assert.ok(
      await browser.waitFor(
        `document.querySelector('.ab-strip-row .ab-strip-panel[href="/anime/${nineties[0].id}"]')`,
        10_000,
      ),
      'the 1990s never came back to the strip',
    )
    // And the sliders moved again, from the cache.
    await setSlider('Tone', 2)
    await setSlider('Complexity', -1)
    await sleep(QUIET_MS)
    const back = await matched()
    assert.deepEqual(
      {
        asked,
        // The 1990s' matches, as they were, while the 1980s' load.
        during: { ...during, matches: during.matches.join() === before.join() },
        matchedFromThe1980s: shown.length === 3 && shown.every((href) => eighties.includes(href)),
        pulledFromThe1980s: eighties.includes(pulled!),
        matchedFromThe1990s: back.length === 3 && back.every((href) => ninetiesPool.includes(href)),
      },
      {
        asked: ['first visit', 'pool 1990s', 'decade and pool 1980s'],
        during: { matches: true, line: 'Filling the machine…' },
        matchedFromThe1980s: true,
        pulledFromThe1980s: true,
        matchedFromThe1990s: true,
      },
    )
    await browser.evaluate(`document.querySelector('.ab-reset').click(); true`)
  })
})

describe('a 1990s pool saved 7 hours ago', () => {
  // The cold visit's pools, saved, the 1990s' made 7 hours old, past its 6 hours' freshness. Its
  // refresh comes back in reverse order, held 2 seconds, so the check can look while it runs. The
  // 1980s' titles and pool are left out of the saved copy, so a later check can ask for the titles
  // alone, and see that a pool wanted for the 1990s is not asked for with them; the 1980s' pool
  // alone, which has no recording of its own, is answered with its half of their request's.
  const old = recordedPool('1990s').titles.map(({ id }) => `/anime/${id}`)
  let fresh: string[] = []
  const asked: string[] = []
  let requests: string[] = []
  before(async () => {
    // The saved copy updates within a second of the page's last change.
    await sleep(1_500)
    await browser.evaluate(`(() => {
      const cache = JSON.parse(localStorage.getItem('anibeam:cache'))
      for (const query of cache.clientState.queries)
        if (query.queryKey[1] === ${JSON.stringify(QUERIES.pool)} && query.queryKey[2].from === ${FIRST_POOL_FROM})
          query.state.dataUpdatedAt -= 7 * 60 * 60 * 1000
      cache.clientState.queries = cache.clientState.queries.filter((query) => !([${JSON.stringify(QUERIES.era)}, ${JSON.stringify(QUERIES.pool)}].includes(query.queryKey[1]) && query.queryKey[2].from === ${EIGHTIES_FROM}))
      localStorage.setItem('anibeam:cache', JSON.stringify(cache))
      return true
    })()`)
    await browser.rewriteAniList(({ request, body }) => {
      asked.push(askedFor(request))
      if (request.query !== QUERIES.pool) return null
      if (request.variables.from === EIGHTIES_FROM) {
        const { p1, p2 } = recordings().get('era-pool-1980s')!.body.data
        return { status: 200, body: { data: { p1, p2 } } }
      }
      const { p1, p2 } = body.data
      const reversed = {
        p1: { ...p1, media: p2.media.toReversed() },
        p2: { ...p2, media: p1.media.toReversed() },
      }
      fresh = poolOf(reversed, MOOD_TAGS).titles.map(({ id }) => `/anime/${id}`)
      return { status: 200, body: { data: reversed } }
    })
    await browser.holdAniList(2_000)
    requests = await watchAniList()
    await browser.load({ reduceMotion: true })
    assert.ok(await browser.titlesShown(), 'no titles on the page')
  })
  after(async () => {
    await browser.holdAniList(0)
    await browser.rewriteAniList(null)
  })
  // Picks the 1990s, and waits out the decade's 300 ms for its titles, from the cache.
  const backToThe1990s = async () => {
    const first = listsOf(recordings().get('first-visit')!).era[0].id
    await browser.evaluate(`document.querySelector('.ab-eras input[value="1990s"]').click(); true`)
    return browser.waitFor(
      `document.querySelector('.ab-strip-row .ab-strip-panel[href="/anime/${first}"]')`,
      10_000,
    )
  }

  test('the first press on a slider sends exactly 1 refresh, the matches stay put while it runs and once it lands on screen, and every move after it sends nothing', async () => {
    const matched = () =>
      browser.evaluate<string[]>(
        `[...document.querySelectorAll('.ab-pull .ab-match[href]')].map((link) => link.getAttribute('href'))`,
      )
    await browser.evaluate(
      `document.querySelector('.ab-pull .ab-matches').scrollIntoView({ block: 'center' }); true`,
    )
    await browser.evaluate(NEXT_FRAME)
    const before = { matches: await matched(), asked: requests.length }
    // A mouse press on Energy's thumb, at no preference, which moves nothing.
    const at = await browser.evaluate<{ x: number; y: number }>(`(() => {
      const r = ${slider('Energy')}.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    const mouse = { ...at, button: 'left', clickCount: 1 } as const
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouse })
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouse })
    assert.ok(await poll(async () => asked.length > 0, 10_000), 'the press asked for nothing')
    const during = await matched()
    // Once the refresh has landed and been saved, the matches still show the old pool's order.
    assert.ok(
      await browser.waitFor(
        `(JSON.parse(localStorage.getItem('anibeam:cache'))?.clientState.queries ?? []).some((query) => query.queryKey[1] === ${JSON.stringify(QUERIES.pool)} && query.queryKey[2].from === ${FIRST_POOL_FROM} && Date.now() - query.state.dataUpdatedAt < 60_000)`,
        10_000,
      ),
      'the refresh never landed',
    )
    await browser.evaluate(NEXT_FRAME)
    const landed = await matched()
    const heard = await everyStopByKeyboard()
    await browser.evaluate(`document.querySelector('.ab-reset').click(); true`)
    await sleep(QUIET_MS)
    // Off screen, the refresh's order shows.
    await browser.evaluate(`scrollTo({ top: 0, behavior: 'instant' }); true`)
    await browser.evaluate(NEXT_FRAME)
    await browser.evaluate(
      `document.querySelector('.ab-pull .ab-matches').scrollIntoView({ block: 'center' }); true`,
    )
    await browser.evaluate(NEXT_FRAME)
    const after = await matched()
    assert.deepEqual(
      { before, during, landed, heard, asked, requests, after },
      {
        before: { matches: old.slice(0, 3), asked: 0 },
        during: old.slice(0, 3),
        landed: old.slice(0, 3),
        heard: EVERY_STOP,
        asked: ['pool 1990s'],
        requests: ['POST'],
        after: fresh.slice(0, 3),
      },
    )
  })

  test('with every slider at No preference, picking the 1980s costs 1 request, its titles alone, and the matches stay headed by the 1990s while their titles stand in', async () => {
    const before = asked.length
    const heading = `document.querySelector('.ab-pull .ab-matches h3').textContent`
    await browser.evaluate(`document.querySelector('.ab-eras input[value="1980s"]').click(); true`)
    // Past the decade's 300 ms wait, its answer still held.
    await sleep(1_000)
    const loading = await browser.evaluate<string>(heading)
    assert.ok(
      await browser.waitFor(
        `document.querySelector('.ab-strip-row .ab-strip-panel[href="/anime/${EIGHTIES_FIRST}"]')`,
        10_000,
      ),
      'the 1980s never came to the strip',
    )
    await sleep(QUIET_MS)
    const landed = await browser.evaluate<string>(heading)
    // Back to the 1990s, from the cache, before the check, as the next check starts there.
    assert.ok(await backToThe1990s(), 'the 1990s never came back to the strip')
    assert.deepEqual(
      { asked: asked.slice(before), loading, landed },
      {
        asked: ['decade 1980s'],
        loading: 'Most popular in the 1990s',
        landed: 'Most popular in the 1980s',
      },
    )
  })

  test('with a slider set and the 1980s’ titles in, picking the 1980s ranks and pulls their titles while their pool loads, never the 1990s’ pool', async () => {
    const before = asked.length
    const eighties = listsOf(recordings().get('era-1980s')!).Page.map(({ id }) => `/anime/${id}`)
    const matched = () =>
      browser.evaluate<string[]>(
        `[...document.querySelectorAll('.ab-pull .ab-match[href]')].map((link) => link.getAttribute('href'))`,
      )
    await setSlider('Energy', -2)
    await browser.evaluate(
      `document.querySelector('.ab-pull .ab-matches').scrollIntoView({ block: 'center' }); true`,
    )
    await browser.evaluate(NEXT_FRAME)
    await browser.evaluate(`document.querySelector('.ab-eras input[value="1980s"]').click(); true`)
    // The pool's answer is held 2 seconds: the machine and a pull meanwhile.
    assert.ok(
      await poll(async () => asked.length > before, 10_000),
      'picking the 1980s asked nothing',
    )
    await browser.evaluate(NEXT_FRAME)
    const during = {
      matches: await matched(),
      line: await browser.evaluate<string>(
        `document.querySelector('.ab-pull .ab-set').textContent`,
      ),
    }
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    const [pulled] = await pulls(1)
    const pending = !(await browser.evaluate<boolean>(poolSaved('1980s')))
    const arrived = await browser.waitFor(poolSaved('1980s'), 10_000)
    await sleep(QUIET_MS)
    await browser.evaluate(`document.querySelector('.ab-reset').click(); true`)
    assert.ok(await backToThe1990s(), 'the 1990s never came back to the strip')
    assert.ok(arrived, 'the 1980s’ pool never arrived')
    assert.deepEqual(
      {
        asked: asked.slice(before),
        pending,
        matchedFromThe1980s:
          during.matches.length === 3 && during.matches.every((href) => eighties.includes(href)),
        line: during.line,
        pulledFromThe1980s: eighties.includes(pulled!),
      },
      {
        asked: ['pool 1980s'],
        pending: true,
        matchedFromThe1980s: true,
        line: 'Filling the machine…',
        pulledFromThe1980s: true,
      },
    )
  })
})

describe('a page whose every title is on My List', () => {
  test('asks for the decade’s pool once, with no press, and the lever then pulls a title of the pool', async () => {
    const page = listsOf(recordings().get('first-visit')!).era.map(({ id }) => id)
    const pool = recordedPool('1990s').titles.map(({ id }) => id)
    // Written on the site's own page, before the load that reads it.
    await browser.forget()
    await browser.load({ reduceMotion: true })
    await browser.evaluate(`(() => {
      const now = Date.now()
      localStorage.setItem('anibeam:list:v1', JSON.stringify(Object.fromEntries(${JSON.stringify(page)}.map((id, i) => [id, { status: 'SAVED', favorite: false, updatedAt: now - i }]))))
      return true
    })()`)
    // Away first: the page the list was written on sees it too, and asks for the pool itself.
    await browser.send('Page.navigate', { url: 'about:blank' })
    await browser.waitFor(`location.href === 'about:blank'`)
    const asked: string[] = []
    await browser.rewriteAniList(({ request }) => {
      asked.push(askedFor(request))
      return null
    })
    try {
      await browser.load({ reduceMotion: true })
      assert.ok(await browser.titlesShown(), 'no titles on the page')
      assert.ok(await browser.waitFor(poolSaved('1990s')), 'the pool never arrived')
      await browser.evaluate(NEXT_FRAME)
      await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
      const [pulled] = await pulls(1)
      await sleep(QUIET_MS)
      const id = Number(pulled?.split('/').pop())
      assert.deepEqual(
        {
          pools: asked.filter((what) => what.includes('pool')),
          inPool: pool.includes(id),
          onPage: page.includes(id),
        },
        { pools: ['pool 1990s'], inPool: true, onPage: false },
      )
    } finally {
      await browser.rewriteAniList(null)
    }
  })

  test('with the mood scoring’s file blocked, its pool fails unseen, and a slider set once the file loads asks for it again', async () => {
    const pool = recordedPool('1990s').titles
    const asked: string[] = []
    // The saved copy updates within a second of the page's last change.
    await sleep(1_500)
    await browser.evaluate(`(() => {
      const cache = JSON.parse(localStorage.getItem('anibeam:cache'))
      cache.clientState.queries = cache.clientState.queries.filter((query) => query.queryKey[1] !== ${JSON.stringify(QUERIES.pool)})
      localStorage.setItem('anibeam:cache', JSON.stringify(cache))
      return true
    })()`)
    await browser.send('Network.enable')
    await browser.send('Network.setBlockedURLs', { urls: ['*/features/mood/scoring.ts*'] })
    await browser.rewriteAniList(({ request }) => {
      asked.push(askedFor(request))
      return null
    })
    try {
      await browser.load({ reduceMotion: true })
      assert.ok(await browser.titlesShown(), 'no titles on the page')
      // The pool tries twice, a second apart, failing each time with the file.
      await sleep(2_500)
      const blocked = [...asked]
      await browser.send('Network.setBlockedURLs', { urls: [] })
      await setSlider('Energy', -2)
      assert.ok(await browser.waitFor(poolSaved('1990s'), 5_000), 'the pool was not asked again')
      await browser.evaluate(NEXT_FRAME)
      const sliders = { energy: -2, tone: 0, complexity: 0 } as const
      assert.deepEqual(
        {
          blocked,
          asked,
          matches: await browser.evaluate<string[]>(MATCHES),
          line: await browser.evaluate<string>(
            `document.querySelector('.ab-pull .ab-set').textContent`,
          ),
        },
        {
          blocked: [],
          asked: ['pool 1990s'],
          matches: rankMatches(pool, sliders)
            .slice(0, 3)
            .map((media) => `/anime/${media.id} Why: ${whyOf(media, sliders).join(' · ')}`),
          line: 'Very cozy',
        },
      )
      await setSlider('Energy', 0)
    } finally {
      await browser.send('Network.setBlockedURLs', { urls: [] })
      await browser.rewriteAniList(null)
    }
  })
})

describe('the decade’s titles not in yet, held for a title, or their refresh failed', () => {
  // The pool waits for the decade's titles (the plan's section 2): it is never asked for while
  // they are on their way, nor while a title opened at its address holds them (a shared link costs
  // one request), nor once their request has failed, and the machine never says "Filling the
  // machine…" while nothing can come.
  const asked: string[] = []
  const line = `document.querySelector('.ab-pull .ab-set').textContent`
  /** A press on Energy and a move to Very cozy, as a finger's would. */
  const pressEnergy = () =>
    browser
      .evaluate(
        `(() => {
      ${slider('Energy')}.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      return true
    })()`,
      )
      .then(() => setSlider('Energy', -2))
  /** Changes the page's saved copy with `change`, page script given its queries. */
  const changeSaved = (change: string) =>
    browser.evaluate(`(() => {
      const cache = JSON.parse(localStorage.getItem('anibeam:cache'))
      cache.clientState.queries = (${change})(cache.clientState.queries)
      localStorage.setItem('anibeam:cache', JSON.stringify(cache))
      return true
    })()`)
  const isPool = `(query) => query.queryKey[1] === ${JSON.stringify(QUERIES.pool)}`
  const isEra = `(query) => query.queryKey[1] === ${JSON.stringify(QUERIES.era)} || query.queryKey[1] === ${JSON.stringify(QUERIES.firstVisit)}`
  before(async () => {
    await browser.forget()
    await browser.rewriteAniList(({ request }) => {
      asked.push(askedFor(request))
      return null
    })
  })
  after(async () => {
    await browser.holdAniList(0)
    await browser.rewriteAniList(null)
  })

  test('a slider pressed before a first visit’s titles land sends nothing until they do, saying “Filling the machine…”, and then the pool', async () => {
    await browser.holdAniList(2_000)
    await browser.load({ reduceMotion: true })
    assert.ok(await browser.waitFor(slider('Energy'), 5_000), 'no slider')
    await pressEnergy()
    await sleep(QUIET_MS)
    const pending = {
      asked: [...asked],
      titles: await browser.evaluate<number>(
        `document.querySelectorAll('.ab-strip-row .ab-strip-panel[href]').length`,
      ),
      line: await browser.evaluate<string>(line),
    }
    await browser.holdAniList(0)
    assert.ok(await browser.titlesShown(), 'no titles on the page')
    assert.ok(await browser.waitFor(poolSaved('1990s')), 'the pool never arrived')
    await sleep(QUIET_MS)
    assert.deepEqual(
      { pending, asked },
      {
        pending: { asked: ['first visit'], titles: 0, line: 'Filling the machine…' },
        asked: ['first visit', 'pool 1990s'],
      },
    )
  })

  test('opened at a title’s address with every title of the page on My List, the page asks for the title alone until its card closes, and then for the pool', async () => {
    const page = listsOf(recordings().get('first-visit')!).era.map(({ id }) => id)
    // The saved copy updates within a second of the page's last change.
    await sleep(1_500)
    await browser.evaluate(`(() => {
      const now = Date.now()
      localStorage.setItem('anibeam:list:v1', JSON.stringify(Object.fromEntries(${JSON.stringify(page)}.map((id, i) => [id, { status: 'SAVED', favorite: false, updatedAt: now - i }]))))
      return true
    })()`)
    await changeSaved(
      `(queries) => queries.filter((query) => !(${isPool})(query) && query.queryKey[1] !== ${JSON.stringify(QUERIES.title)})`,
    )
    asked.length = 0
    await browser.load({ reduceMotion: true, url: new URL('/anime/154587', BASE_URL).href })
    assert.ok(
      await browser.waitFor(
        `document.querySelector('dialog.ab-card[open] #ab-card-title')`,
        10_000,
      ),
      'no title card',
    )
    await sleep(QUIET_MS)
    const open = [...asked]
    await browser.press('Escape')
    assert.ok(await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5_000), 'open')
    assert.ok(await browser.waitFor(poolSaved('1990s')), 'the pool never arrived')
    await sleep(QUIET_MS)
    assert.deepEqual({ open, closed: asked }, { open: ['title'], closed: ['title', 'pool 1990s'] })
  })

  test('with the decade’s saved titles out of date and their refresh failing, a slider set asks for no pool and never says “Filling the machine…”', async () => {
    await sleep(1_500)
    await browser.evaluate(`localStorage.removeItem('anibeam:list:v1'), true`)
    await changeSaved(
      `(queries) => queries.filter((query) => !(${isPool})(query)).map((query) => ((${isEra})(query) ? { ...query, state: { ...query.state, dataUpdatedAt: query.state.dataUpdatedAt - 7 * 60 * 60 * 1000 } } : query))`,
    )
    asked.length = 0
    await browser.rewriteAniList(({ request }) => {
      asked.push(askedFor(request))
      return request.query === QUERIES.era
        ? { status: 500, body: { data: null, errors: [{ message: 'Internal Server Error.' }] } }
        : null
    })
    await browser.load({ reduceMotion: true })
    // The strip offers Try again once its last retry has failed.
    assert.ok(
      await browser.waitFor(
        `document.querySelector('.ab-strip[aria-labelledby="decades"] .ab-retry')`,
        20_000,
      ),
      'the refresh never failed for good',
    )
    await pressEnergy()
    await sleep(QUIET_MS)
    const soon = await browser.evaluate<string>(line)
    await sleep(2_000)
    assert.deepEqual(
      {
        soon,
        later: await browser.evaluate<string>(line),
        titles: await browser.evaluate<boolean>(
          `document.querySelectorAll('.ab-strip-row .ab-strip-panel[href]').length > 3`,
        ),
        pools: asked.filter((what) => what.includes('pool')),
      },
      { soon: 'Very cozy', later: 'Very cozy', titles: true, pools: [] },
    )
  })
})

describe('a first visit offline, with the mood scoring blocked, then AniList busy', () => {
  // The scoring's file can't load (offline on a first visit, or an old tab after a deploy renamed
  // it), and the first visit's answer is held while the connection drops. Then the pool's first
  // request gets AniList's 429, with its reset a second away.
  const asked: string[] = []
  const page = listsOf(recordings().get('first-visit')!).era
  const pool = recordedPool('1990s').titles
  const goOffline = (offline: boolean) =>
    browser.send('Network.emulateNetworkConditions', {
      offline,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })
  const machine = `({
    line: document.querySelector('.ab-pull .ab-set').textContent,
    heard: document.querySelector('.ab-pull > [role="status"]').textContent,
    retry: document.querySelector('.ab-pull .ab-matches .ab-retry')?.textContent ?? 'none',
    matches: ${MATCHES},
  })`
  before(async () => {
    await browser.forget()
    await browser.send('Network.enable')
    await browser.send('Network.setBlockedURLs', { urls: ['*/features/mood/scoring.ts*'] })
    let busy = true
    await browser.rewriteAniList(({ request }) => {
      asked.push(askedFor(request))
      if (request.query !== QUERIES.pool || !busy) return null
      busy = false
      return {
        status: 429,
        body: { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] },
        headers: {
          'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + 1),
          'X-RateLimit-Remaining': '0',
        },
      }
    })
    await browser.holdAniList(10_000)
    await browser.load({ reduceMotion: true })
  })
  after(async () => {
    await goOffline(false)
    await browser.holdAniList(0)
    await browser.send('Network.setBlockedURLs', { urls: [] })
    await browser.rewriteAniList(null)
  })

  test('offline with no titles yet, the sliders, Reset moods and the lever are off, and the line says so', async () => {
    await goOffline(true)
    const off = await browser.waitFor(`document.querySelector('.ab-pull fieldset').disabled`, 5_000)
    const seen = await browser.evaluate(`({
      sliders: [...document.querySelectorAll('.ab-pull input[type="range"]')].every((input) => input.matches(':disabled')),
      reset: document.querySelector('.ab-reset').disabled,
      lever: document.querySelector('.ab-lever').disabled,
      line: document.querySelector('.ab-pull .ab-set').textContent,
      heard: document.querySelector('.ab-pull > [role="status"]').textContent,
    })`)
    await goOffline(false)
    await browser.holdAniList(0)
    assert.ok(await browser.titlesShown(), 'no titles on the page once back online')
    assert.deepEqual(
      { off, seen },
      {
        off: true,
        seen: {
          sliders: true,
          reset: true,
          lever: true,
          line: 'Offline: waiting for a connection.',
          heard: 'Offline: waiting for a connection.',
        },
      },
    )
  })

  test('with the scoring’s file blocked, a set slider says so with Try again, asking AniList nothing, and Try again, once it loads, ranks the matches through AniList’s busy wait', async () => {
    await browser.evaluate(
      `document.querySelector('.ab-pull .ab-matches').scrollIntoView({ block: 'center' }); true`,
    )
    await browser.evaluate(`(() => {
      ${slider('Energy')}.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      return true
    })()`)
    await setSlider('Energy', -2)
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-pull .ab-matches .ab-retry')`, 5_000),
      'no Try again',
    )
    await sleep(QUIET_MS)
    const blocked = { ...(await browser.evaluate<object>(machine)), asked: [...asked] }
    await browser.send('Network.setBlockedURLs', { urls: [] })
    await browser.evaluate(`document.querySelector('.ab-pull .ab-matches .ab-retry').click(); true`)
    assert.ok(
      await browser.waitFor(
        `document.querySelector('.ab-pull .ab-set').textContent.startsWith('AniList is busy')`,
        5_000,
      ),
      'the busy line never showed',
    )
    const busy = { ...(await browser.evaluate<object>(machine)), asked: [...asked] }
    assert.ok(await browser.waitFor(poolSaved('1990s'), 10_000), 'the pool never arrived')
    await browser.evaluate(NEXT_FRAME)
    const ranked = { ...(await browser.evaluate<object>(machine)), asked: [...asked] }
    await setSlider('Energy', 0)
    const sliders = { energy: -2, tone: 0, complexity: 0 } as const
    const top = (titles: readonly Media[]) =>
      rankMatches(titles, sliders)
        .slice(0, 3)
        .map((media) => `/anime/${media.id} Why: ${whyOf(media, sliders).join(' · ')}`)
    assert.deepEqual(
      { blocked, busy, ranked },
      {
        // The page's titles in their own order, unranked, with no Why.
        blocked: {
          line: 'The mood scoring didn’t load.',
          heard: 'The mood scoring didn’t load.',
          retry: 'Try again',
          matches: pullable(page)
            .slice(0, 3)
            .map(({ id }) => `/anime/${id} `),
          asked: ['first visit'],
        },
        busy: {
          line: 'AniList is busy right now. It’s not something you did. Trying again within a minute.',
          heard:
            'AniList is busy right now. It’s not something you did. Trying again within a minute.',
          retry: 'none',
          matches: top(pullable(page.map(cardOf))),
          asked: ['first visit', 'pool 1990s'],
        },
        ranked: {
          line: 'Very cozy',
          // Neither the sliders' words nor "Filling the machine…" are said.
          heard: '',
          retry: 'none',
          matches: top(pool),
          asked: ['first visit', 'pool 1990s', 'pool 1990s'],
        },
      },
    )
  })
})

/** A decade's two pool pages from AniList, `pool`, cut to page 1's first 25 titles. */
const cutTo25 = (pool: any) => ({
  p1: { ...pool.p1, media: pool.p1.media.slice(0, 25) },
  p2: { ...pool.p2, media: [] },
})

describe('page 3 and the end states', () => {
  // The 1990s' pool cut to its 25 most popular titles, page 2 still saying there is a page 3, so
  // a few rolls bring it near its end (the plan's PR 4, commit 7), and page 3 is AniList's (REC-4).
  // And Pre-1970, a decade of 56 titles with no page 3 (REC-3b), whose own page no check records:
  // it is answered with its pool's first 20, as AniList would send them.
  const asked: string[] = []
  const nineties = poolOf(cutTo25(recordings().get('pool-1990s')!.body.data), MOOD_TAGS)
  const page3 = recordedPage3('1990s')
  const preData = recordings().get('pool-pre-1970')!.body.data
  const pre = recordedPool('pre-1970').titles
  const status = `document.querySelector('.ab-pull > [role="status"]').textContent`
  const line = `document.querySelector('.ab-pull .ab-set').textContent`
  before(async () => {
    await browser.forget()
    await browser.rewriteAniList(({ request, status, body }) => {
      const what = askedFor(request)
      asked.push(what)
      if (what === 'pool 1990s') return { status, body: { data: cutTo25(body.data) } }
      if (what === 'decade pre-1970')
        return {
          status: 200,
          body: {
            data: {
              Page: {
                // With their relations, which a page's query doesn't ask for and nothing reads.
                media: preData.p1.media.slice(0, 20),
              },
            },
          },
        }
      return null
    })
    await browser.load({ reduceMotion: true })
    assert.ok(await browser.titlesShown(), 'no titles on the page')
  })
  after(() => browser.rewriteAniList(null))

  test('with a pool of 25 that has a page 3, the roll that leaves fewer than 10 to come up asks for it, once and none before; its titles then come up, and slider moves still cost nothing', async () => {
    assert.ok(nineties.hasNextPage && nineties.titles.length >= NEED_MORE + 5, 'not a pool to roll')
    await setSlider('Energy', -2)
    assert.ok(await browser.waitFor(poolSaved('1990s')), 'the pool never arrived')
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    // A roll asks for page 3 when fewer than NEED_MORE are left before it rolls: these leave
    // NEED_MORE or more.
    const early = nineties.titles.length - NEED_MORE + 1
    const before = await rollsSaid(early)
    await sleep(QUIET_MS)
    const quiet = [...asked]
    const [last] = await rollsSaid(1)
    assert.ok(await browser.waitFor(page3Saved('1990s')), 'page 3 never arrived')
    const after = await rollsSaid(10)
    // Every stop of every slider, asking for nothing.
    await eachSetting(SETTINGS, '() => true')
    await setSlider('Energy', -2)
    await rollsSaid(3)
    await sleep(QUIET_MS)
    await browser.evaluate(`document.querySelector('.ab-reset').click(); true`)
    const ids = [...before, last, ...after].map(({ href }) => Number(href?.split('/').pop()))
    const fromPage3 = new Set(
      page3
        .filter(({ id }) => !nineties.titles.some((other) => other.id === id))
        .map(({ id }) => id),
    )
    assert.deepEqual(
      {
        quiet,
        asked,
        different: new Set(ids).size,
        // With Math.random at 0 a roll takes the best match left at Very cozy: once page 3 is in,
        // the pool's 8 left are its worst, so page 3's titles come up first.
        page3After: ids.slice(early + 1).filter((id) => fromPage3.has(id)).length > 0,
        page3Before: ids.slice(0, early + 1).filter((id) => fromPage3.has(id)),
        said: [...before, last, ...after].filter(
          ({ said }) => !/^Roll \d+: .+, (SSR|SR|R|Mystery)\.$/.test(said),
        ),
      },
      {
        quiet: ['first visit', 'pool 1990s'],
        asked: ['first visit', 'pool 1990s', 'pool page 3 1990s'],
        different: early + 11,
        page3After: true,
        page3Before: [],
        // Over 20 left once page 3 is in, and before, not all of the decade: no line, nothing said.
        said: [],
      },
    )
  })

  test('in a decade with no page 3, five left off My List: the line counts them down, each roll says it once, the sixth is a repeat under the repeats line, and no page 3 is asked for', async () => {
    // The last five of Pre-1970's pool, none of them among its page's 20: every title on the page
    // is on My List, so the machine asks for the pool with no press.
    const left = pre.slice(-5)
    const listed = pre.filter((media) => !left.includes(media)).map(({ id }) => id)
    await setList(listed)
    await browser.evaluate(
      `document.querySelector('.ab-eras input[value="pre-1970"]').click(); true`,
    )
    assert.ok(
      await browser.waitFor(
        `${poolSaved('pre-1970')} && !document.querySelector('.ab-lever').disabled && ${line} === ${JSON.stringify(fewLine(5))}`,
        10_000,
      ),
      'the pool never arrived, or the line never counted 5 left',
    )
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    const rolled = []
    for (let i = 0; i < 6; i++) {
      const [roll] = await rollsSaid(1)
      rolled.push({ ...roll, line: await browser.evaluate<string>(line) })
    }
    await sleep(QUIET_MS)
    const hrefs = rolled.map(({ href }) => href)
    const titleAt = (href: string | null) =>
      titleOf(pre.find(({ id }) => `/anime/${id}` === href) ?? left[0])
    assert.deepEqual(
      {
        five: hrefs.slice(0, 5).sort(),
        sixth: hrefs[5],
        lines: rolled.map(({ line }) => line),
        said: rolled.map(({ said }) =>
          said.replace(/^Roll \d+: /, '').replace(/, (SSR|SR|R|Mystery)\./, ','),
        ),
        page3: asked.filter((what) => what === 'pool page 3 pre-1970'),
        asked: asked.slice(-2),
      },
      {
        five: left.map(({ id }) => `/anime/${id}`).sort(),
        sixth: hrefs[0],
        lines: [fewLine(4), fewLine(3), fewLine(2), fewLine(1), REPEATS, REPEATS],
        said: rolled.map(({ href, line }) => `${titleAt(href)}, ${line}`),
        page3: [],
        asked: ['decade pre-1970', 'pool pre-1970'],
      },
    )
  })

  test('a change to My List with no roll changes the line, never what the status line said of the last roll', async () => {
    // Repeats on: one more title taken off My List turns them off, then back on as it goes back.
    const said = await browser.evaluate<string>(status)
    // The page's first title, on My List from the check before, never rolled.
    const other = pre[0].id
    await setList([other], false)
    await browser.evaluate(NEXT_FRAME)
    const off = {
      line: await browser.evaluate<string>(line),
      said: await browser.evaluate<string>(status),
    }
    await setList([other])
    await browser.evaluate(NEXT_FRAME)
    const on = {
      line: await browser.evaluate<string>(line),
      said: await browser.evaluate<string>(status),
    }
    assert.ok(said.endsWith(REPEATS), `the last roll said “${said}”`)
    assert.deepEqual({ off, on }, { off: { line: fewLine(1), said }, on: { line: REPEATS, said } })
  })

  test('with the rolled card showing, every title left put on My List turns the lever and Roll again off, and the line, said once, says why', async () => {
    await setList(pre.map(({ id }) => id))
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-lever').disabled`, 5_000),
      'the lever stayed on',
    )
    const machine = await browser.evaluate<object>(`({
      again: [...document.querySelectorAll('.ab-result button')].find((button) => button.textContent.trim() === 'Roll again').disabled,
      line: ${line},
      said: ${status},
    })`)
    await setList(
      pre.map(({ id }) => id),
      false,
    )
    assert.deepEqual(machine, { again: true, line: LISTED, said: LISTED })
  })
})

describe('page 3 held back', () => {
  // The 1990s' pool cut to 25, as above, and page 3's first request answered with AniList's 429,
  // its reset 4 seconds away: the pool's last titles can all be rolled while it waits. Then the
  // page loaded again with the pool saved but not page 3, and the mood scoring's file blocked.
  const asked: string[] = []
  const nineties = poolOf(cutTo25(recordings().get('pool-1990s')!.body.data), MOOD_TAGS)
  const fromPage3 = new Set(
    recordedPage3('1990s')
      .filter(({ id }) => !nineties.titles.some((other) => other.id === id))
      .map(({ id }) => `/anime/${id}`),
  )
  // The rolls made with NEED_MORE or more left before them: the next asks for page 3.
  const early = nineties.titles.length - NEED_MORE + 1
  const line = `document.querySelector('.ab-pull .ab-set').textContent`
  const BUSY =
    'AniList is busy right now. It’s not something you did. Trying again within a minute.'
  before(async () => {
    await browser.forget()
    let busy = true
    await browser.rewriteAniList(({ request, status, body }) => {
      const what = askedFor(request)
      asked.push(what)
      if (what === 'pool 1990s') return { status, body: { data: cutTo25(body.data) } }
      if (what !== 'pool page 3 1990s' || !busy) return null
      busy = false
      return {
        status: 429,
        body: { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] },
        headers: {
          'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + 4),
          'X-RateLimit-Remaining': '0',
        },
      }
    })
    await browser.load({ reduceMotion: true })
    assert.ok(await browser.titlesShown(), 'no titles on the page')
  })
  after(async () => {
    await browser.send('Network.setBlockedURLs', { urls: [] })
    await browser.rewriteAniList(null)
  })

  test('with page 3 held by AniList’s 429, the pool’s last titles roll under the busy line, none said as repeats, and page 3’s titles come up once it lands', async () => {
    await setSlider('Energy', -2)
    assert.ok(await browser.waitFor(poolSaved('1990s')), 'the pool never arrived')
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    await rollsSaid(early)
    const [asking] = await rollsSaid(1)
    assert.ok(
      await browser.waitFor(`${line} === ${JSON.stringify(BUSY)}`, 5_000),
      'the busy line never showed',
    )
    // The pool's 8 titles left, then 2 repeats, while page 3 waits.
    const held = await rollsSaid(NEED_MORE)
    const waiting = { line: await browser.evaluate<string>(line), asked: [...asked] }
    assert.ok(await browser.waitFor(page3Saved('1990s'), 10_000), 'page 3 never arrived')
    await browser.evaluate(NEXT_FRAME)
    const landed = await browser.evaluate<string>(line)
    const [next] = await rollsSaid(1)
    await setSlider('Energy', 0)
    assert.deepEqual(
      {
        said: [asking, ...held, next].filter(
          ({ said }) => !/^Roll \d+: .+, (SSR|SR|R|Mystery)\.$/.test(said),
        ),
        waiting,
        landed,
        next: fromPage3.has(next.href ?? ''),
      },
      {
        said: [],
        waiting: { line: BUSY, asked: ['first visit', 'pool 1990s', 'pool page 3 1990s'] },
        landed: 'Very cozy',
        next: true,
      },
    )
  })

  test('page 3 wanted while the mood scoring’s file can’t load fails unseen, and a slider set once it loads asks for page 3 again', async () => {
    // The saved copy updates within a second of the page's last change. Page 3 is taken out of it,
    // and the page loaded again, so the scoring isn't loaded and no slider is set.
    await sleep(1_500)
    await browser.evaluate(`(() => {
      const cache = JSON.parse(localStorage.getItem('anibeam:cache'))
      cache.clientState.queries = cache.clientState.queries.filter((query) => query.queryKey[1] !== ${JSON.stringify(QUERIES.poolPage3)})
      localStorage.setItem('anibeam:cache', JSON.stringify(cache))
      return true
    })()`)
    await browser.send('Network.enable')
    await browser.send('Network.setBlockedURLs', { urls: ['*/features/mood/scoring.ts*'] })
    await browser.load({ reduceMotion: true })
    assert.ok(await browser.titlesShown(), 'no titles on the page')
    asked.length = 0
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    // The last of these asks for page 3, whose scoring can't load; its one retry, a second later,
    // fails too.
    const rolled = await rollsSaid(early + 1)
    await sleep(3_000)
    const blocked = [...asked]
    await browser.send('Network.setBlockedURLs', { urls: [] })
    await setSlider('Energy', -2)
    const again = await browser.waitFor(page3Saved('1990s'), 10_000)
    await setSlider('Energy', 0)
    assert.deepEqual(
      {
        rolled: rolled.filter(({ href }) => !href).length,
        blocked,
        again,
        asked: asked.filter((what) => what.startsWith('pool')),
      },
      { rolled: 0, blocked: [], again: true, asked: ['pool page 3 1990s'] },
    )
  })
})
