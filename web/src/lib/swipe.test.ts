import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  afterSwipe,
  dragOffset,
  opens,
  opensFrom,
  pageMoved,
  rowScrolls,
  shuts,
  speed,
  swipeMoved,
  swipeStart,
  type Swipe,
} from './swipe.ts'

const at = (clientX: number, clientY: number, timeStamp: number) => ({
  pointerId: 1,
  clientX,
  clientY,
  timeStamp,
})

/** A finger from (100, 300) through `moves` ([x, y, t] each), with the page's 2:1 lock or 1:1. */
function drag(moves: [number, number, number][], ratio = 1) {
  let s = swipeStart({ ...at(100, 300, 0), pointerType: 'touch' }) as Swipe
  for (const [x, y, t] of moves) s = swipeMoved(s, at(x, y, t), ratio)
  return s
}

test('a mouse never swipes; a finger and a pen do', () => {
  assert.equal(swipeStart({ ...at(0, 0, 0), pointerType: 'mouse' }), null)
  assert.ok(swipeStart({ ...at(0, 0, 0), pointerType: 'touch' }))
  assert.ok(swipeStart({ ...at(0, 0, 0), pointerType: 'pen' }))
})

test('zoomed in by a pinch, a finger starts no swipe, so it pans the page; at the page’s own scale, or a hair over it, it does', () => {
  const swipeAt = (scale: number) => {
    Object.assign(globalThis, { visualViewport: { scale } })
    try {
      return swipeStart({ ...at(0, 0, 0), pointerType: 'touch' })
    } finally {
      Reflect.deleteProperty(globalThis, 'visualViewport')
    }
  }
  assert.equal(swipeAt(2.5), null, 'at 2.5 times')
  assert.equal(swipeAt(1.02), null, 'at 1.02 times')
  assert.ok(swipeAt(1), 'at the page’s own scale')
  assert.ok(swipeAt(1.005), 'what a pinch back out can leave')
})

test('the way is decided once the finger has gone 10px, and kept', () => {
  assert.equal(drag([[109, 300, 16]]).axis, undefined)
  assert.equal(drag([[110, 300, 16]]).axis, 'x')
  assert.equal(drag([[100, 310, 16]]).axis, 'y')
  assert.equal(
    drag([
      [110, 300, 16],
      [110, 400, 32],
    ]).axis,
    'x',
    'kept',
  )
  // The page's lock: across must be more than twice up or down.
  assert.equal(drag([[112, 306, 16]], 2).axis, 'y')
  assert.equal(drag([[113, 306, 16]], 2).axis, 'x')
  // Another finger changes nothing.
  const s = drag([[110, 300, 16]])
  assert.deepEqual(swipeMoved(s, { ...at(300, 300, 32), pointerId: 2 }), s)
})

test('the speed is over the last 100 ms of the swipe only', () => {
  // A slow 300 ms drag, then a quick last 40px in 50 ms.
  const s = drag([
    [130, 300, 100],
    [160, 300, 200],
    [190, 300, 300],
    [230, 300, 350],
  ])
  assert.equal(speed(s), 0.8, 'only the samples within 100 ms: 40px in 50 ms')
  // A finger held still for 200 ms before it lifts has no speed left.
  assert.equal(
    speed(
      drag([
        [200, 300, 50],
        [200, 300, 250],
      ]),
    ),
    0,
  )
})

test('the header opens the menu at 48px right, or at 24px with a flick faster than 0.4 px/ms', () => {
  assert.equal(opens(drag([[148, 300, 400]])), true, '48px, slow')
  assert.equal(opens(drag([[147, 300, 400]])), false, '47px, slow')
  assert.equal(opens(drag([[124, 300, 40]])), true, '24px in 40 ms')
  assert.equal(opens(drag([[123, 300, 40]])), false, '23px is too short for a flick')
  assert.equal(opens(drag([[120, 300, 300]])), false, '20px over 300 ms')
  assert.equal(
    opens(
      drag([
        [100, 360, 100],
        [160, 360, 200],
      ]),
    ),
    false,
    'up and down first',
  )
})

/**
 * A finger on the page from (100, 300) through `moves`, as the page's listener reads it: whether
 * it opened the menu, ended as no sideways swipe, or goes on, undecided or short.
 */
function pageDrag(moves: [number, number, number][]) {
  let s = swipeStart({ ...at(100, 300, 0), pointerType: 'touch' })
  for (const [x, y, t] of moves) {
    s = s && pageMoved(s, at(x, y, t))
    if (s && opens(s)) return 'opens'
  }
  return s ? 'goes on' : 'ends'
}

/** From (x, y) at `t` ms, `steps` moves of `dx` across and `dy` down, 16 ms apart. */
const steps = (x: number, y: number, t: number, count: number, dx: number, dy: number) =>
  Array.from(
    { length: count },
    (_, i) => [x + dx * (i + 1), y + dy * (i + 1), t + 16 * (i + 1)] as [number, number, number],
  )

test('a swipe on the page stays sideways only while it has gone more than twice as far across as up or down, at every move: a scroll whose first pixels hook right ends it, and never opens the menu', () => {
  assert.equal(
    pageDrag([[112, 300, 16], ...steps(112, 300, 16, 10, 4, -30)]),
    'ends',
    '12px right, then 300px up drifting 40px right',
  )
  assert.equal(
    pageDrag([[118, 298, 16], ...steps(118, 298, 16, 10, 3.6, -30)]),
    'ends',
    '18px right and 2px up, then 300px up drifting 36px right',
  )
  assert.equal(
    pageDrag([
      [104, 300, 16],
      [108, 299, 32],
      [112, 298, 48],
      [116, 297, 64],
      [120, 296, 80],
      ...steps(120, 296, 80, 10, 4, -25),
    ]),
    'ends',
    '20px right drifting 4px up, then 250px up drifting 40px right',
  )
  assert.equal(
    pageDrag([
      [112, 300, 10],
      [130, 260, 40],
    ]),
    'ends',
    'a quick fling up the screen, its first 12px right',
  )
  assert.equal(pageDrag([[102, 312, 16]]), 'ends', 'up and down first')
  assert.equal(pageDrag([[105, 302, 16]]), 'goes on', 'within 10px, undecided')
  assert.equal(
    pageDrag([
      [112, 302, 100],
      [130, 306, 200],
      [150, 310, 300],
    ]),
    'opens',
    '50px right drifting 10px down',
  )
})

test('a drag of the menu shuts it past 30% of its width left, or on a flick left', () => {
  assert.equal(shuts(drag([[3, 300, 500]]), 320), true, '97px of 320, slow')
  assert.equal(shuts(drag([[5, 300, 500]]), 320), false, '95px of 320, slow')
  assert.equal(shuts(drag([[40, 300, 100]]), 320), true, '60px in 100 ms')
  assert.equal(shuts(drag([[60, 300, 600]]), 320), false, '40px slow springs back')
  assert.equal(shuts(drag([[100, 500, 50]]), 320), false, 'up and down')
  assert.equal(
    shuts(
      drag([
        [50, 300, 300],
        [120, 300, 350],
      ]),
      320,
    ),
    false,
    'a flick back right',
  )
  // Still left of where it started, but the last of it a quick flick right: 60px left, then 50px
  // back in 50 ms. Only a flick left shuts it.
  assert.equal(
    shuts(
      drag([
        [0, 300, 300],
        [40, 300, 350],
      ]),
      320,
    ),
    false,
    'dragged left, then flicked back right',
  )
})

test('the menu follows the finger left, and only rubber-bands right', () => {
  assert.equal(dragOffset(-130), -130)
  assert.equal(dragOffset(0), 0)
  assert.ok(dragOffset(100) < 30)
  assert.ok(dragOffset(100) > dragOffset(50))
})

test('a click within 500 ms of the swipe that opened the menu is the swipe’s own; a later one, or one with no swipe, is not', () => {
  assert.equal(afterSwipe(1000, 1000), true, 'at once')
  assert.equal(afterSwipe(1000, 1500), true, '500 ms on')
  assert.equal(afterSwipe(1000, 1501), false, '501 ms on')
  assert.equal(afterSwipe(-Infinity, 20), false, 'no swipe yet')
})

/** A stand-in for an element: the selectors it matches, and whether it scrolls sideways. */
type Spot = {
  parentElement: Spot | null
  is: string[]
  scrolls?: boolean
  closest(s: string): unknown
}
function spot(is: string[], parentElement: Spot | null = null, scrolls = false): Spot {
  const self: Spot = {
    parentElement,
    is,
    scrolls,
    // As Element.closest does: itself or an ancestor matching any of the selectors in the list.
    closest(selectors) {
      const wanted = selectors.split(',').map((s) => s.trim())
      for (let at: Spot | null = self; at; at = at.parentElement)
        if (at.is.some((s) => wanted.includes(s))) return at
      return null
    },
  }
  return self
}
const rowOf = (s: Spot) => Boolean(s.scrolls)

test('a swipe opens the menu from anywhere on the page, but not the search bubble, a slider, a dialog or a row that scrolls sideways itself', () => {
  const page = spot(['main'])
  const panel = spot(['img'], spot(['.ab-panel'], page))
  assert.equal(opensFrom(panel, rowOf), true, 'a trending panel')
  assert.equal(opensFrom(page, rowOf), true, 'empty paper')
  assert.equal(
    opensFrom(spot(['textarea'], spot(['.ab-bubble-field'], page)), rowOf),
    false,
    'the search box',
  )
  assert.equal(opensFrom(spot(['input[type="range"]'], page), rowOf), false, 'a slider')
  assert.equal(opensFrom(spot(['h2'], spot(['dialog'], page)), rowOf), false, 'the title card')
  const strip = spot(['ol'], page, true)
  assert.equal(
    opensFrom(spot(['img'], spot(['li'], strip)), rowOf),
    false,
    'a panel in the decade strip',
  )
  assert.equal(opensFrom(strip, rowOf), false, 'the strip itself')
  assert.equal(opensFrom(null, rowOf), false, 'nothing')
})

test('a row scrolls sideways itself only when it is wider inside than out and lets its overflow scroll', () => {
  const row = { scrollWidth: 900, clientWidth: 374 }
  assert.equal(rowScrolls(row, 'auto'), true)
  assert.equal(rowScrolls(row, 'scroll'), true)
  assert.equal(rowScrolls(row, 'hidden'), false, 'hidden: only a script scrolls it')
  assert.equal(rowScrolls(row, 'clip'), false)
  assert.equal(rowScrolls(row, 'visible'), false)
  assert.equal(rowScrolls({ scrollWidth: 374, clientWidth: 374 }, 'auto'), false, 'all of it shows')
})
