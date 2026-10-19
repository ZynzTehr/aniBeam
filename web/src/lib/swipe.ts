/**
 * Sideways swipes on a phone (the menu's: see MenuDrawer and SiteHeader). Pure rules, so unit
 * tests hold them without a browser; the components feed them pointer events.
 */

/** A flick this fast (px/ms) counts, however short; the system's Back edge is this wide. */
export const FLICK = 0.4
export const EDGE = 24
/** How far a drag on the header must go right to open the menu. */
export const OPEN_DRAG = 48
/** The share of the menu's width a drag must cover to shut it. */
export const SHUT_SHARE = 0.3
/** How far a finger may wander before the swipe is decided sideways or up and down. */
export const SLOP = 10
/** How far back the speed looks (ms): a flick's end, not the whole drag. */
export const WINDOW = 100

/**
 * One finger's swipe: where it started, how far it has gone across, which way it was decided,
 * and where the finger was over the last WINDOW ms ([time, x] pairs), for its speed.
 */
export type Swipe = {
  id: number
  x: number
  y: number
  dx: number
  axis?: 'x' | 'y'
  trail: [number, number][]
}

type Point = { pointerId: number; clientX: number; clientY: number; timeStamp: number }

/** A swipe starting: a finger or a pen, never a mouse, which has its buttons. */
export const swipeStart = (e: Point & { pointerType: string }): Swipe | null =>
  e.pointerType === 'mouse'
    ? null
    : { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, trail: [[e.timeStamp, e.clientX]] }

/**
 * The swipe after the finger moved (or lifted): undecided within SLOP, then sideways or not for
 * good. Sideways only if it went across more than `ratio` times as far as up or down: 2 for the
 * header, so a page scroll that drifts never opens the menu.
 */
export function swipeMoved(s: Swipe, e: Point, ratio = 1): Swipe {
  if (e.pointerId !== s.id) return s
  const dx = e.clientX - s.x
  const dy = e.clientY - s.y
  const axis =
    s.axis ??
    (Math.hypot(dx, dy) < SLOP ? undefined : Math.abs(dx) > ratio * Math.abs(dy) ? 'x' : 'y')
  const trail = [...s.trail, [e.timeStamp, e.clientX] as [number, number]].filter(
    ([t]) => t >= e.timeStamp - WINDOW,
  )
  return { ...s, axis, dx, trail }
}

/** How fast the finger went across over the last WINDOW ms, in px/ms (rightward positive). */
export function speed({ trail }: Swipe) {
  const [t0, x0] = trail[0]
  const [t1, x1] = trail[trail.length - 1]
  return t1 > t0 ? (x1 - x0) / (t1 - t0) : 0
}

/** Whether a sideways swipe on the header opens the menu: far enough right, or a flick right. */
export const opens = (s: Swipe) =>
  s.axis === 'x' && (s.dx >= OPEN_DRAG || (s.dx >= EDGE && speed(s) > FLICK))

/** Whether a sideways drag of the open menu, let go, shuts it: far enough left, or a flick left. */
export const shuts = (s: Swipe, width: number) =>
  s.axis === 'x' && (s.dx < -width * SHUT_SHARE || (s.dx < 0 && speed(s) < -FLICK))

/** Where the menu sits under the finger: with it to the left, and only a little to the right. */
export const dragOffset = (dx: number) => (dx < 0 ? dx : 6 * Math.log1p(dx))

/**
 * Whether a click at `clickAt` (an event's timeStamp) is the swipe's own, the one a browser may
 * send where the finger lifted, on the logo, say: within 500 ms of the swipe that opened the menu
 * at `openedAt`. Only then, so a later tap or key is never eaten.
 */
export const afterSwipe = (openedAt: number, clickAt: number) => clickAt - openedAt <= 500
