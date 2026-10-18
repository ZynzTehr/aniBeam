import { reducedMotion, watchDeviceMotion } from './motion.ts'

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
 * what has focus (`focusUnder`), unless focus is in it; a dialog open over the page leaves it as
 * it is, and so does a scroll that a move of focus made (`fromFocus`, as Tab and a link's jump
 * do), unless that left focus under it. Else it
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
  if (dialogOpen) return { barIn, anchor: y }
  // Never over what has focus, a scroll that a move of focus made included (Shift+Tab to
  // something above the screen brings it in at the top, under the bar).
  if (!focusInBar && (!eligible || focusUnder)) return { barIn: false, anchor: y }
  if (fromFocus) return { barIn, anchor: y }
  if (barIn) {
    if (y < anchor) return { barIn, anchor: y }
    if (y - anchor >= BAR_SLACK && !focusInBar) return { barIn: false, anchor: y }
    return { barIn, anchor }
  }
  if (y > anchor) return { barIn, anchor: y }
  if (anchor - y >= BAR_SLACK) return { barIn: true, anchor: y }
  return { barIn, anchor }
}

/**
 * The flight of the intro's buttons into the header and back down, as signed off from draft #22:
 * one 420 ms move with a slight overshoot, the buttons 45 ms apart.
 */
export const FLIGHT = {
  duration: 420,
  stagger: 45,
  easing: 'cubic-bezier(0.2, 1.35, 0.35, 1)',
} as const

/** A box on the screen or the page. */
export type Box = { left: number; top: number; width: number; height: number }

/**
 * The keyframes of one button's flight from `from` to `to`, drawn at `to`: it moves from the middle
 * of `from` to that of `to`, its pill grows or shrinks from the size of one to the other, its label
 * crosses from the one it leaves to the one it arrives as, halfway, and its hard shadow fades from
 * the look of one end to the other's (`shadows`: whether each has one; an intro button does, a
 * header link only as the current section's). Only transforms and opacity change, so nothing is
 * laid out again, and the label is never stretched.
 */
export function flightFrames(from: Box, to: Box, shadows = { from: true, to: true }) {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2)
  const dy = from.top + from.height / 2 - (to.top + to.height / 2)
  return {
    move: [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
    pill: [
      { transform: `scale(${from.width / to.width}, ${from.height / to.height})` },
      { transform: 'none' },
    ],
    leaving: [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }],
    arriving: [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }],
    shadow: [{ opacity: shadows.from ? 1 : 0 }, { opacity: shadows.to ? 1 : 0 }],
  }
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
  // A scroll the visitor made since the last look: only such a scroll flies the buttons.
  let scrolledByVisitor = false
  // The set shown, and the flight under way, if any (its animations).
  let shown: LinkSet | undefined
  let flight: Animation[] | null = null
  // The copies that fly, drawn over the page, out of reach and unread.
  const layer = document.body.appendChild(document.createElement('div'))
  layer.className = 'ab-flight'
  layer.setAttribute('aria-hidden', 'true')
  layer.inert = true

  const headerBottomNow = () => header.getBoundingClientRect().bottom

  const apply = (set: LinkSet) => {
    shown = set
    app.dataset.links = set
    if (bar) bar.inert = set !== 'bar'
  }

  // Ends a flight where it was going, at once: on landing, and as anything cuts it short (Tab, a
  // click on a link, the switch to reduce motion, a search), then shows the set the page is at.
  const finishFlight = () => {
    if (!flight) return
    const running = flight
    flight = null
    for (const animation of running) animation.cancel()
    layer.replaceChildren()
    delete layer.dataset.flying
    evaluate()
  }

  // Flies the intro's buttons into the header's slots, or back down into the intro, with copies:
  // the two sets hide meanwhile (data-links="none"). A dock lands on the sticky header, so it is
  // drawn on the screen; an undock lands in the page, so it is drawn on the page, and holds its
  // place as the visitor scrolls.
  const fly = (set: 'intro' | 'header', pairs: { button: HTMLElement; link: HTMLElement }[]) => {
    if (reducedMotion()) return apply(set)
    const toHeader = set === 'header'
    const onPage = !toHeader
    layer.style.position = onPage ? 'absolute' : 'fixed'
    const [dx, dy] = onPage ? [scrollX, scrollY] : [0, 0]
    // Neither set shows until it lands, when the set the page is at is applied.
    shown = undefined
    app.dataset.links = 'none'
    layer.replaceChildren()
    layer.dataset.flying = ''
    flight = pairs.flatMap(({ button, link }, i) => {
      // A dock starts where the button shows: it can be partly under the header by then, and a
      // copy drawn there would show over the header what the header hides.
      const start = (toHeader ? button : link).getBoundingClientRect()
      const from =
        toHeader && start.top < headerBottomNow()
          ? new DOMRect(start.left, headerBottomNow(), start.width, start.height)
          : start
      const box = (toHeader ? link : button).getBoundingClientRect()
      // The link to the section the visitor is in sits raised 2px up and left, as it is about to
      // be marked: the copy lands where it will be.
      const raised =
        toHeader && link.getAttribute('href') === current && !link.hasAttribute('aria-current')
      const to = raised ? new DOMRect(box.left - 2, box.top - 2, box.width, box.height) : box
      const chip = layer.appendChild(document.createElement('span'))
      chip.className = 'ab-flight-chip'
      Object.assign(chip.style, {
        left: `${to.left + dx}px`,
        top: `${to.top + dy}px`,
        width: `${to.width}px`,
        height: `${to.height}px`,
      })
      // Its shadow, under its pill, and its pill. Landing on the section the visitor is in, it
      // arrives in that link's yellow, raised on its shadow.
      const onCurrent = link.getAttribute('href') === current
      const shadow = chip.appendChild(document.createElement('span'))
      shadow.className = 'ab-flight-shadow'
      const pill = chip.appendChild(document.createElement('span'))
      pill.className = 'ab-flight-pill'
      if (toHeader && onCurrent) pill.classList.add('is-current')
      const [leaving, arriving] = [button, link].map((source) => {
        const label = chip.appendChild(document.createElement('span'))
        label.className = 'ab-flight-label'
        label.textContent = source.textContent
        return label
      })
      const frames = flightFrames(from, to, {
        from: toHeader || onCurrent,
        to: !toHeader || onCurrent,
      })
      const timing = {
        duration: FLIGHT.duration,
        delay: i * FLIGHT.stagger,
        fill: 'backwards' as const,
      }
      const moving = { ...timing, easing: FLIGHT.easing }
      return [
        chip.animate(frames.move, moving),
        pill.animate(frames.pill, moving),
        shadow.animate(frames.pill, moving),
        shadow.animate(frames.shadow, timing),
        (toHeader ? leaving : arriving).animate(frames.leaving, timing),
        (toHeader ? arriving : leaving).animate(frames.arriving, timing),
      ]
    })
    const landing = flight
    // A flight cut short cancels its animations, which rejects their promise: that is no fault.
    void Promise.all(landing.map((animation) => animation.finished)).then(
      () => {
        if (flight === landing) finishFlight()
      },
      () => {},
    )
  }

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
    // The bar's bottom where it rests (it starts above the screen's top, for its overshoot).
    return box.bottom > 0 && box.top < bar.offsetTop + bar.offsetHeight + 9
  }

  const evaluate = () => {
    frame = 0
    const byVisitor = scrolledByVisitor
    scrolledByVisitor = false
    const headerBottom = header.getBoundingClientRect().bottom
    // The section the visitor is in, first: a flight landing on its link arrives in its yellow.
    const tops = SECTIONS.map(
      (id) => document.getElementById(id)?.closest('section')?.getBoundingClientRect().top,
    )
    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 1
    const index = currentSection(tops, sectionLine(headerBottom, innerHeight), atEnd && scrollY > 0)
    const next = index < 0 ? null : `#${SECTIONS[index]}`
    if (next !== current) {
      current = next
      onCurrent(next)
    }
    // The links, once the page has said whether it has an intro. Under 900px the header scrolls
    // away, so the buttons never dock: the header's links show only with no intro (a search).
    const fromFocus = scrolledByFocus
    scrolledByFocus = false
    if (actions === undefined) {
      delete app.dataset.links
      shown = undefined
    } else {
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
      const focusHeld = held()
      const set = linkSet({
        introOnPage: Boolean(actions),
        docked,
        barIn: barState.barIn,
        held: focusHeld,
      })
      // The buttons fly between the intro and the header only as the visitor scrolls them past
      // it, with both ends on the screen, the intro's entrance over and nothing in the way: else
      // the sets swap at once (a jump, Tab, a reload, a resize, reduced motion).
      const pairs = SECTIONS.flatMap((id) => {
        const button = actions?.querySelector<HTMLElement>(`a[href="#${id}"]`)
        const link = header.querySelector<HTMLElement>(`.ab-nav a[href="#${id}"]`)
        return button && link ? [{ button, link }] : []
      })
      const onScreen = pairs.every(({ button, link }) =>
        [button, link].every((el) => {
          const box = el.getBoundingClientRect()
          return box.bottom > 0 && box.top < innerHeight
        }),
      )
      // Mid-flight the sets wait for it to land, which looks again.
      if (
        !flight &&
        wide &&
        actions &&
        set !== shown &&
        (set === 'header' || set === 'intro') &&
        (shown === 'header' || shown === 'intro') &&
        byVisitor &&
        !fromFocus &&
        !focusHeld &&
        onScreen &&
        !actions.getAnimations({ subtree: true }).some((a) => a.playState === 'running') &&
        !document.querySelector('dialog[open]')
      )
        fly(set, pairs)
      else if (!flight && set !== shown) apply(set)
    }
  }
  // At most once a frame, however many scroll events come.
  const soon = () => {
    if (!frame) frame = requestAnimationFrame(evaluate)
  }
  const scrolled = () => {
    if (focusMoved) scrolledByFocus = true
    else scrolledByVisitor = true
    soon()
  }
  const focusCame = () => {
    // Focus moving mid-flight lands it first, so focus never meets a set hidden for it.
    finishFlight()
    focusMoved = true
    requestAnimationFrame(() => (focusMoved = false))
    // And a look once it has landed, even with no scroll and nothing left (Tab from the page's
    // start onto something already under a phone's bar).
    soon()
  }
  // Tab lands a flight before focus moves.
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Tab') finishFlight()
  }
  // Asked for reduced motion mid-flight, from the device or the site's switch: it lands at once.
  const motionChanged = () => {
    if (reducedMotion()) finishFlight()
  }
  const stopWatchingDevice = watchDeviceMotion(motionChanged)
  const siteSwitch = new MutationObserver(motionChanged)
  siteSwitch.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-motion'],
  })
  // Focus leaving a set that it held: the set the page is at may now show, once focus has landed
  // (as it leaves, the page still reports it where it was), so a frame later.
  const focusLeft = () => soon()
  addEventListener('scroll', scrolled, { passive: true })
  addEventListener('resize', soon)
  document.addEventListener('focusout', focusLeft, true)
  document.addEventListener('focusin', focusCame, true)
  document.addEventListener('keydown', keyDown, true)
  // Sections change size as titles load and lists change, moving those below them.
  const sizes = new ResizeObserver(soon)
  sizes.observe(header)
  const main = document.querySelector('main')
  if (main) sizes.observe(main)
  evaluate()
  return {
    /** The intro's buttons, or null while there is none: decided at once, before it is drawn. */
    intro(next: HTMLElement | null) {
      finishFlight()
      if (actions) sizes.unobserve(actions)
      actions = next
      if (next) sizes.observe(next)
      // A new intro (a search cleared) docks by where it is, not by where the last one was.
      docked = false
      evaluate()
    },
    stop() {
      finishFlight()
      layer.remove()
      stopWatchingDevice()
      siteSwitch.disconnect()
      document.removeEventListener('keydown', keyDown, true)
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
