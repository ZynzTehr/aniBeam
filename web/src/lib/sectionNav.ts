/**
 * The page's section links (spec §5, the design signed off from draft #22). The intro's three
 * buttons are the section links while they are on the page; the header's Trending, Pull and
 * Decades links wait hidden in their place, and from 900px, where the header stays on screen, take
 * over once it reaches the buttons (the buttons dock). The header marks the section the visitor
 * is in. One set of links is shown, reachable and read at a time. Its rules are pure functions, so
 * unit tests hold them without a browser; startSectionNav applies them to the page, writing which
 * set shows as data-links on the page's root (.ab-app), which components.css reads.
 */

/** The page's sections, in reading order, by the id of the heading each link leads to. */
export const SECTIONS = ['ab-trending', 'pull', 'decades'] as const

/**
 * Where a section counts as reached: two thirds of the way down the screen below the header, so a
 * section is the visitor's once it is well in view (Trending as soon as the intro has gone). A
 * header scrolled away (a phone's) leaves the whole screen.
 */
export function sectionLine(headerBottom: number, viewportHeight: number) {
  const top = Math.max(0, headerBottom)
  return top + ((viewportHeight - top) * 2) / 3
}

/**
 * The section the visitor is in, by its place in `tops` (each section's top on the screen, or
 * undefined for one not on the page): the last whose top has passed `line`, or the last section at
 * the end of the page, where a short last section can never reach the line; -1 above the first.
 */
export function currentSection(tops: (number | undefined)[], line: number, atEnd: boolean) {
  if (atEnd) {
    for (let i = tops.length - 1; i >= 0; i--) if (tops[i] !== undefined) return i
    return -1
  }
  let current = -1
  tops.forEach((top, i) => {
    if (top !== undefined && top <= line) current = i
  })
  return current
}

/** How far below the header the buttons' place in the intro must be before they undock. */
export const UNDOCK_GAP = 200

/**
 * Whether the intro's buttons are docked in the header, given whether they were: they dock as the
 * header's bottom reaches their top, and undock only once their place in the intro is well into
 * view again, UNDOCK_GAP below the header (or as far below it as they sit at the top of the page,
 * on a screen too short for that), or at the top of the page. In between, they stay as they were.
 * `actionsTop` is their top on the screen, `homeGap` how far below the header they sit at the top.
 */
export function dockedAfter(
  docked: boolean,
  {
    actionsTop,
    headerBottom,
    homeGap,
    scrollY,
  }: {
    actionsTop: number
    headerBottom: number
    homeGap: number
    scrollY: number
  },
) {
  if (scrollY <= 0) return false
  if (!docked) return actionsTop <= headerBottom
  return actionsTop < headerBottom + Math.min(Math.max(homeGap, 0), UNDOCK_GAP)
}

/** Which set of section links shows: the intro's buttons, the header's links, or a phone's bar. */
export type LinkSet = 'intro' | 'header' | 'bar'

/**
 * Which set shows: the one that has focus, so that focus is never hidden; a phone's bar while it
 * is in; the header's with no intro on the page (while searching); otherwise the header's once
 * the buttons are docked.
 */
export function linkSet({
  introOnPage,
  docked,
  barIn,
  held,
}: {
  introOnPage: boolean
  docked: boolean
  barIn: boolean
  held: LinkSet | null
}): LinkSet {
  if (held) return held
  if (barIn) return 'bar'
  if (!introOnPage) return 'header'
  return docked ? 'header' : 'intro'
}

/** How far the page must scroll against the bar's way (up while out, down while in) to flip it. */
export const BAR_SLACK = 8

/** A phone's bar: whether it is in, and the scroll its last flip, or the farthest since, was at. */
export type BarState = { barIn: boolean; anchor: number }

/**
 * A phone's bar after the page has scrolled to `y`. It is in only once what it stands for has
 * scrolled away (`eligible`: the intro's buttons, or the header while searching), and never over
 * what has focus (`focusUnder`), unless focus is in it; a dialog open over the page, and a scroll
 * that a move of focus made (`fromFocus`, as Tab and a link's jump do), leave it as it is. Else it
 * comes in on a scroll up of BAR_SLACK or more, from the lowest point since it went out, and goes
 * out on a scroll down of as much, from the highest point since it came in, unless focus is in it.
 */
export function barAfter(
  { barIn, anchor }: BarState,
  {
    y,
    eligible,
    focusInBar,
    focusUnder,
    fromFocus,
    dialogOpen,
  }: {
    y: number
    eligible: boolean
    focusInBar: boolean
    focusUnder: boolean
    fromFocus: boolean
    dialogOpen: boolean
  },
): BarState {
  if (dialogOpen || fromFocus) return { barIn, anchor: y }
  if (!focusInBar && (!eligible || focusUnder)) return { barIn: false, anchor: y }
  if (barIn) {
    if (y < anchor) return { barIn, anchor: y }
    if (y - anchor >= BAR_SLACK && !focusInBar) return { barIn: false, anchor: y }
    return { barIn, anchor }
  }
  if (y > anchor) return { barIn, anchor: y }
  if (anchor - y >= BAR_SLACK) return { barIn: true, anchor: y }
  return { barIn, anchor }
}

// Where an element's box is laid out on the page, its transforms (an entrance, a hover's lift)
// left out: the sum of its offsets.
const layoutTop = (element: HTMLElement) => {
  let top = 0
  for (let el: HTMLElement | null = element; el; el = el.offsetParent as HTMLElement | null)
    top += el.offsetTop
  return top
}

/**
 * Follows the section the visitor is in as the page scrolls, resizes or changes, and hands its
 * link's address (#pull, say) to `onCurrent` each time it changes, null above the first section.
 * It also writes the set of section links that shows as data-links on `app`: from 900px, where the
 * header is sticky, the intro's buttons dock in it and undock; under 900px they never dock.
 * `intro()` tells it the intro's buttons (their nav), or null while there is no intro (a search).
 * Returns them, and a stop.
 */
export function startSectionNav({
  app,
  header,
  bar,
  onCurrent,
}: {
  app: HTMLElement
  header: HTMLElement
  /** A phone's bar of the section links (SectionBar): inert while it isn't the set shown. */
  bar: HTMLElement | null
  onCurrent: (href: string | null) => void
}) {
  let current: string | null | undefined
  let actions: HTMLElement | null | undefined
  let docked = false
  let barState: BarState = { barIn: false, anchor: scrollY }
  let frame = 0
  // A move of focus scrolls the page as it brings what took focus into view (Tab, a link's jump):
  // such a scroll leaves a phone's bar as it is. The scroll comes in the frame of the move, before
  // the frame's own callbacks, so a flag set as focus moves and cleared a frame later tells it.
  let focusMoved = false
  let scrolledByFocus = false

  // The set that holds focus, so it stays shown.
  const held = (): LinkSet | null => {
    const focused = document.activeElement
    if (!focused || focused === document.body) return null
    if (actions?.contains(focused)) return 'intro'
    if (focused.matches('.ab-top .ab-nav a')) return 'header'
    if (bar?.contains(focused)) return 'bar'
    return null
  }

  // Whether what has focus is under a phone's bar, where it would hide it: its box, and its ring
  // (7px out, 2px more for a raised pill), reach above the bar's bottom while on the screen.
  const focusUnder = () => {
    const focused = document.activeElement as HTMLElement | null
    if (!bar || !focused || focused === document.body || bar.contains(focused)) return false
    const shown = focused.matches('label > input') ? focused.nextElementSibling : focused
    const box = (shown ?? focused).getBoundingClientRect()
    return box.bottom > 0 && box.top < bar.offsetHeight + 9
  }

  const evaluate = () => {
    frame = 0
    const headerBottom = header.getBoundingClientRect().bottom
    // The links, once the page has said whether it has an intro. Under 900px the header scrolls
    // away, so the buttons never dock: the header's links show only with no intro (a search).
    const fromFocus = scrolledByFocus
    scrolledByFocus = false
    if (actions === undefined) delete app.dataset.links
    else {
      const wide = getComputedStyle(header).position === 'sticky'
      if (!wide) docked = false
      else if (actions) {
        // Where the header ends at the top of the page: where the page's main part starts, as
        // sticking moves the header (and its offsetTop) but nothing laid out after it.
        const main = document.querySelector('main')
        const home = layoutTop(actions)
        docked = dockedAfter(docked, {
          actionsTop: home - scrollY,
          headerBottom,
          homeGap: home - (main ? layoutTop(main) : header.offsetHeight),
          scrollY,
        })
      }
      // A phone's bar, once what it stands for has scrolled off the top: the intro's buttons, or,
      // with no intro, the header.
      const y = Math.max(0, Math.min(scrollY, document.documentElement.scrollHeight - innerHeight))
      barState = wide
        ? { barIn: false, anchor: y }
        : barAfter(barState, {
            y,
            eligible: actions
              ? layoutTop(actions) + actions.offsetHeight - scrollY <= 0
              : headerBottom <= 0,
            focusInBar: held() === 'bar',
            focusUnder: focusUnder(),
            fromFocus,
            dialogOpen: Boolean(document.querySelector('dialog[open]')),
          })
      const set = linkSet({
        introOnPage: Boolean(actions),
        docked,
        barIn: barState.barIn,
        held: held(),
      })
      app.dataset.links = set
      if (bar) bar.inert = set !== 'bar'
    }
    // The section the visitor is in.
    const tops = SECTIONS.map(
      (id) => document.getElementById(id)?.closest('section')?.getBoundingClientRect().top,
    )
    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 1
    const index = currentSection(tops, sectionLine(headerBottom, innerHeight), atEnd && scrollY > 0)
    const next = index < 0 ? null : `#${SECTIONS[index]}`
    if (next === current) return
    current = next
    onCurrent(next)
  }
  // At most once a frame, however many scroll events come.
  const soon = () => {
    if (!frame) frame = requestAnimationFrame(evaluate)
  }
  const scrolled = () => {
    if (focusMoved) scrolledByFocus = true
    soon()
  }
  const focusCame = () => {
    focusMoved = true
    requestAnimationFrame(() => (focusMoved = false))
  }
  // Focus leaving a set that it held: the set the page is at may now show, once focus has landed
  // (as it leaves, the page still reports it where it was), so a frame later.
  const focusLeft = () => soon()
  addEventListener('scroll', scrolled, { passive: true })
  addEventListener('resize', soon)
  document.addEventListener('focusout', focusLeft, true)
  document.addEventListener('focusin', focusCame, true)
  // Sections change size as titles load and lists change, moving those below them.
  const sizes = new ResizeObserver(soon)
  sizes.observe(header)
  const main = document.querySelector('main')
  if (main) sizes.observe(main)
  evaluate()
  return {
    /** The intro's buttons, or null while there is none: decided at once, before it is drawn. */
    intro(next: HTMLElement | null) {
      if (actions) sizes.unobserve(actions)
      actions = next
      if (next) sizes.observe(next)
      // A new intro (a search cleared) docks by where it is, not by where the last one was.
      docked = false
      evaluate()
    },
    stop() {
      removeEventListener('scroll', scrolled)
      removeEventListener('resize', soon)
      document.removeEventListener('focusout', focusLeft, true)
      document.removeEventListener('focusin', focusCame, true)
      if (bar) bar.inert = true
      sizes.disconnect()
      cancelAnimationFrame(frame)
      delete app.dataset.links
    },
  }
}
