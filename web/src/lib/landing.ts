/**
 * The scroll slam: parts of the page that land once, as they scroll into view (DESIGN.md, the
 * native engine chosen from draft #16). Each part carries data-land, which the motion gates in
 * components.css read:
 *   wait  not seen yet: see-through, still in its place and in the Tab order;
 *   go    landing: its slam plays, --k steps of the stagger after the first of those landing with
 *         it;
 *   done  landed, with no animation left, so moving it in the page (React reorders keyed items)
 *         replays nothing.
 * Under reduced motion, from the device or the site, the gates show every part as it is, still,
 * whatever its data-land says. This file only decides when; CSS does all the moving.
 */
export type Land = 'wait' | 'go' | 'done'

/** How much of a part must show before it lands at once. */
export const LANDING_RATIO = 0.15

/**
 * How long a part must stay in view, short of LANDING_RATIO, before it lands all the same: so a
 * decade's card peeking in at the row's edge shows, but one scrolled past doesn't land unseen.
 */
export const LINGER_MS = 200

/**
 * The parts that land: the trending panels, the decade and search cards (their list items, which
 * the row snaps to; the card inside moves), not the empty ones that hold their place; the pull
 * machine; and the section headings, whose sound effect booms (not the intro's).
 */
export const LANDING_PARTS =
  '.ab-grid:not([aria-hidden]) > .ab-panel, .ab-strip-row:not([aria-hidden]) > .ab-strip-item, .ab-machine, .ab-sfx'

/** What happens to a part: found on the page, seen on the screen, focused, its slam played. */
type Happening = 'found' | 'seen' | 'focused' | 'played'

/**
 * How a part stands after something happens to it. A part waits once found, lands once seen and is
 * done once its slam has played; keyboard focus lands it at once, waiting or mid-slam, so focus
 * never meets a part that is see-through or still moving. A part lands once: nothing takes it back.
 */
export function landAfter(land: Land | undefined, happening: Happening): Land | undefined {
  if (happening === 'focused') return 'done'
  if (happening === 'found') return land ?? 'wait'
  if (happening === 'seen') return land === 'wait' ? 'go' : land
  return land === 'go' ? 'done' : land
}

/**
 * The parts an IntersectionObserver's report says land now, in reading order: those waiting with
 * at least LANDING_RATIO of them on screen. Parts that come into view together land one after
 * another, in this order.
 */
export function landingNow(
  entries: Pick<IntersectionObserverEntry, 'target' | 'intersectionRatio'>[],
): HTMLElement[] {
  return entries
    .filter(
      ({ target, intersectionRatio }) =>
        intersectionRatio >= LANDING_RATIO - 0.001 && landOf(target as HTMLElement) === 'wait',
    )
    .map(({ target }) => target as HTMLElement)
    .sort((a, b) => (a.compareDocumentPosition(b) & FOLLOWING ? -1 : 1))
}

/**
 * The waiting parts an IntersectionObserver's report says are in view, but short of landing at
 * once: slivers, which land only if they stay in view for LINGER_MS.
 */
export function slivers(
  entries: Pick<IntersectionObserverEntry, 'target' | 'intersectionRatio' | 'isIntersecting'>[],
): HTMLElement[] {
  return entries
    .filter(
      ({ target, intersectionRatio, isIntersecting }) =>
        isIntersecting &&
        intersectionRatio > 0 &&
        intersectionRatio < LANDING_RATIO - 0.001 &&
        landOf(target as HTMLElement) === 'wait',
    )
    .map(({ target }) => target as HTMLElement)
    .sort((a, b) => (a.compareDocumentPosition(b) & FOLLOWING ? -1 : 1))
}

/** The parts a report says have left the screen: a sliver's wait to land ends. */
export function outOfSight(
  entries: Pick<IntersectionObserverEntry, 'target' | 'isIntersecting'>[],
): HTMLElement[] {
  return entries
    .filter(({ isIntersecting }) => !isIntersecting)
    .map(({ target }) => target as HTMLElement)
}

// Node.DOCUMENT_POSITION_FOLLOWING, without needing a DOM to name it.
const FOLLOWING = 4

const landOf = (part: HTMLElement) => part.dataset.land as Land | undefined

/**
 * Lands the parts `selector` finds, those on the page now and each that arrives later (as titles
 * load, a decade or a search changes), as each scrolls into view. Returns a stop.
 */
export function startLanding(selector: string) {
  const set = (part: HTMLElement, happening: Happening) => {
    const land = landAfter(landOf(part), happening)
    if (land && land !== landOf(part)) part.dataset.land = land
    if (land === 'done') {
      observer.unobserve(part)
      part.style.removeProperty('--k')
    }
    return land
  }
  // Lands a part, --k steps of the stagger after the first of those landing with it.
  const land = (part: HTMLElement, k: number) => {
    clearTimeout(lingering.get(part))
    lingering.delete(part)
    observer.unobserve(part)
    part.style.setProperty('--k', String(k))
    set(part, 'seen')
    // Done once its animations on the page's own clock have finished: at once under reduced
    // motion, which has none. Asking for them brings the part's styles up to date first.
    const playing = part
      .getAnimations({ subtree: true })
      .filter(
        (animation) =>
          animation.timeline === document.timeline &&
          animation.effect?.getComputedTiming().endTime !== Infinity,
      )
      .map((animation) => animation.finished)
    void Promise.allSettled(playing).then(() => set(part, 'played'))
  }
  // Each sliver's timer, until it lands or leaves the screen.
  const lingering = new Map<HTMLElement, ReturnType<typeof setTimeout>>()
  const observer = new IntersectionObserver(
    (entries) => {
      for (const part of outOfSight(entries)) {
        clearTimeout(lingering.get(part))
        lingering.delete(part)
      }
      landingNow(entries).forEach(land)
      for (const part of slivers(entries))
        if (!lingering.has(part))
          lingering.set(
            part,
            setTimeout(() => {
              if (landOf(part) === 'wait') land(part, 0)
            }, LINGER_MS),
          )
    },
    { threshold: [0, LANDING_RATIO] },
  )
  // Waiting parts too, not only new ones: started again (as React's StrictMode does in development),
  // the parts the first start marked would otherwise never be watched.
  const find = () => {
    for (const part of document.querySelectorAll<HTMLElement>(selector))
      if (set(part, 'found') === 'wait') observer.observe(part)
  }
  // A MutationObserver's report comes before the browser draws, so a part never shows unmarked.
  const arrivals = new MutationObserver(find)
  arrivals.observe(document.body, { childList: true, subtree: true })
  find()
  // In the capture phase, so the part has landed before anything on the way handles the focus,
  // such as the strip scrolling the focused card into view. A part that takes focus itself while
  // out of the Tab order (tabindex -1), as a section heading does when a link jumps to it, lands as
  // if seen, so its boom plays where the visitor arrives; focus inside a part, from the keyboard,
  // lands it at once.
  const focused = (event: FocusEvent) => {
    const part = (event.target as Element | null)?.closest?.<HTMLElement>('[data-land]')
    if (!part) return
    if (part === event.target && part.tabIndex < 0) {
      if (landOf(part) === 'wait') land(part, 0)
    } else set(part, 'focused')
  }
  document.addEventListener('focusin', focused, true)
  return () => {
    observer.disconnect()
    arrivals.disconnect()
    document.removeEventListener('focusin', focused, true)
  }
}
