/**
 * Sideways swipes on a phone (the menu's: see MenuDrawer and SiteHeader). Pure rules, so unit
 * tests hold them without a browser; the components feed them pointer and touch events.
 */

/** A flick this fast (px/ms) counts, however short; the system's Back edge is this wide. */
export const FLICK = 0.4
export const EDGE = 24
/** How far a swipe on the page must go right to open the menu. */
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

/**
 * Whether the visitor has pinched the page bigger than its own scale; a hair over counts for
 * none, as a pinch back out can leave it there. Zoomed in, a finger's sideways drag pans the
 * page, as anywhere else, for a visitor who zooms in to read: no swipe starts.
 */
export const zoomed = () => (globalThis.visualViewport?.scale ?? 1) > 1.01

/** A swipe starting: a finger or a pen, never a mouse, which has its buttons, nor zoomed in. */
export const swipeStart = (e: Point & { pointerType: string }): Swipe | null =>
  e.pointerType === 'mouse' || zoomed()
    ? null
    : { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, trail: [[e.timeStamp, e.clientX]] }

/**
 * The swipe after the finger moved (or lifted): undecided within SLOP, then sideways or not for
 * good. Sideways only if it went across more than `ratio` times as far as up or down: 2 for the
 * page, so a scroll that drifts never opens the menu.
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

/**
 * Where on the page a swipe may not open the menu: in the search bubble, where a drag selects
 * text, on a slider, which a drag moves, and in a dialog (the title card, or the menu itself).
 */
export const KEEP_OUT = '.ab-bubble-field, input[type="range"], dialog'

/** As much of an element as `opensFrom` reads: what it is, and what it sits in. */
type Spot = { closest(selectors: string): unknown; parentElement: Spot | null }

/**
 * Whether a swipe that starts on `target` may open the menu: anywhere on the page but KEEP_OUT
 * and a row that scrolls sideways itself (`scrolls`, rowScrolls on the page), as the decade strip
 * does, where a swipe scrolls the row.
 */
export function opensFrom<T extends Spot>(target: T | null, scrolls: (spot: T) => boolean) {
  if (!target || target.closest(KEEP_OUT)) return false
  for (let at: T | null = target; at; at = at.parentElement as T | null)
    if (scrolls(at)) return false
  return true
}

/** Whether a row scrolls sideways itself: wider inside than out, its overflow scrolling. */
export const rowScrolls = (
  { scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number },
  overflowX: string,
) => scrollWidth > clientWidth && (overflowX === 'auto' || overflowX === 'scroll')

/** Whether a sideways swipe on the page opens the menu: far enough right, or a flick right. */
export const opens = (s: Swipe) =>
  s.axis === 'x' && (s.dx >= OPEN_DRAG || (s.dx >= EDGE && speed(s) > FLICK))

/** Whether a sideways drag of the open menu, let go, shuts it: far enough left, or a flick left. */
export const shuts = (s: Swipe, width: number) =>
  s.axis === 'x' && (s.dx < -width * SHUT_SHARE || (s.dx < 0 && speed(s) < -FLICK))

/** Where the menu sits under the finger: with it to the left, and only a little to the right. */
export const dragOffset = (dx: number) => (dx < 0 ? dx : 6 * Math.log1p(dx))

/**
 * Whether a click at `clickAt` (an event's timeStamp) is the swipe's own, the one a browser may
 * send where the finger lifted, on a link, say: within 500 ms of the swipe that opened the menu
 * at `openedAt`. Only then, so a later tap or key is never eaten.
 */
export const afterSwipe = (openedAt: number, clickAt: number) => clickAt - openedAt <= 500
