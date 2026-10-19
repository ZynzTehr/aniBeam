import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  afterSwipe,
  dragOffset,
  opens,
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

/** A finger from (100, 300) through `moves` ([x, y, t] each), with the header's 2:1 lock or 1:1. */
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
  // The header's lock: across must be more than twice up or down.
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
