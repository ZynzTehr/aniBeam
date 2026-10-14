import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { reducedMotion, watchDeviceMotion } from '../lib/motion.ts'
import './gsap.css'
import { landOf, landOnFocus, setLand, watchParts } from './parts.ts'

// Draft PR 3 (never merged): the GSAP engine. The same parts, states and knobs as the native
// engine (parts.ts), but GSAP's ScrollTrigger decides when and its tweens do the moving, with the
// same beats as native.css. Lazy-loaded, as gsap and ScrollTrigger add about 39 KB brotli.
// Pitfalls the research named, and how this avoids them:
// - opacity, not autoAlpha, whose visibility: hidden would take parts out of the Tab order;
// - each slam ends by clearing only what it set (opacity, transform, --ink), so the CSS hover
//   zoom, caption lift and lever tilt work again, and React's own style variables stay;
// - ScrollTrigger measures only on a window resize, so any change in the page's height (status
//   lines, Try again, the outage samples, search, decades, fonts) calls refresh();
// - it hears only media queries, so reduced motion comes from lib/motion.ts, site switch included.

gsap.registerPlugin(ScrollTrigger)

/** How much of a part must show before it lands, as in the native engine. */
const RATIO = 0.15
const START = `${RATIO * 100}% bottom` // coming in from below
const END = `${(1 - RATIO) * 100}% top` // coming back in from above
const SPRING = 'back.out(1.7)'

/** The knobs (slam.css, parts.ts) as numbers: scale, tilt in degrees, stagger in seconds. */
function knobs() {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => parseFloat(style.getPropertyValue(name))
  return {
    scale: read('--slam-scale'),
    tilt: read('--slam-tilt'),
    stagger: read('--slam-stagger') / 1000,
  }
}

const readingOrder = (a: Element, b: Element) =>
  a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1

const timelines = new Map<HTMLElement, gsap.core.Timeline>()

/** What a part's slam sets styles on: the part, its cover, caption or card, or a heading's effect. */
function pieces(part: HTMLElement) {
  const inside = part.querySelectorAll<HTMLElement>('.ab-img img, .ab-caption, .ab-strip-panel')
  const effect = part.matches('.ab-sfx') ? [part.lastElementChild as HTMLElement] : []
  return [part, ...inside, ...effect].filter(Boolean)
}

/** Stops a part's slam and takes away only the styles it set. */
function clear(part: HTMLElement) {
  timelines.get(part)?.kill()
  timelines.delete(part)
  gsap.set(pieces(part), { clearProps: 'opacity,transform' })
  part.style.removeProperty('--ink')
}

function finish(part: HTMLElement) {
  clear(part)
  if (landOf(part) === 'go') setLand(part, 'done')
}

/** Plays one part's slam after `at` seconds, with the same beats as native.css. */
function slam(part: HTMLElement, at: number, k: ReturnType<typeof knobs>) {
  const tl = gsap.timeline({ delay: at, onComplete: () => finish(part) })
  const pop = { opacity: 1, rotation: 0, scale: 1, ease: SPRING }
  if (part.matches('.ab-panel')) {
    // A solid ink panel slams in, the ink wipes off (through --ink: GSAP can't reach ::after),
    // the cover settles and the caption pops.
    tl.fromTo(part, { opacity: 0 }, { opacity: 1, duration: 0.125, ease: 'none' }, 0)
      .fromTo(
        part,
        { scale: k.scale, rotation: k.tilt },
        { scale: 0.985, rotation: -0.12 * k.tilt, duration: 0.31, ease: 'power2.out' },
        0,
      )
      .to(part, { scale: 1, rotation: 0, duration: 0.19, ease: 'power1.out' }, 0.31)
      .fromTo(part, { '--ink': 1 }, { '--ink': 0, duration: 0.6, ease: 'power3.inOut' }, 0.16)
    const cover = part.querySelector('.ab-img img')
    if (cover) tl.fromTo(cover, { scale: 1.3 }, { scale: 1, duration: 1, ease: 'power3.out' }, 0.2)
    const caption = part.querySelector('.ab-caption')
    if (caption)
      tl.fromTo(caption, { opacity: 0, rotation: -6, scale: 0.6 }, { ...pop, duration: 0.6 }, 0.52)
  } else if (part.matches('.ab-strip-item')) {
    const card = part.querySelector('.ab-strip-panel')
    if (card)
      tl.fromTo(card, { opacity: 0, rotation: -6, scale: 0.6 }, { ...pop, duration: 0.6 }, 0)
  } else if (part.matches('.ab-sfx')) {
    const effect = part.lastElementChild
    if (effect)
      tl.fromTo(effect, { opacity: 0, rotation: -30, scale: 2.4 }, { ...pop, duration: 0.7 }, 0)
  } else {
    tl.fromTo(
      part,
      { opacity: 0, y: -48, scale: 1.06 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: SPRING },
      0,
    )
  }
  timelines.set(part, tl)
}

/** Lands the waiting parts of a group, one after another in reading order (none with reduced motion). */
function landGroup(group: Element[]) {
  const ready = (group as HTMLElement[])
    .filter((part) => part.isConnected && landOf(part) === 'wait')
    .sort(readingOrder)
  if (reducedMotion()) return ready.forEach((part) => setLand(part, 'done'))
  const k = knobs()
  ready.forEach((part, i) => {
    setLand(part, 'go')
    slam(part, i * (part.matches('.ab-strip-item') ? (k.stagger * 2) / 3 : k.stagger), k)
  })
}

// A jump (a header link, a skip link, Home) passes parts without showing them: ScrollTrigger
// still calls onEnter for them, so only those on screen land, and the rest wait to be seen.
const onScreen = (group: Element[]) =>
  group.filter((part) => ScrollTrigger.isInViewport(part, 0.01))

/** Parts that land as the page scrolls: panels, headings, the machine and search results. */
function watchDown(parts: HTMLElement[]) {
  ScrollTrigger.batch(parts, {
    start: START,
    end: END,
    interval: 0.05,
    onEnter: (group) => landGroup(onScreen(group)),
    onEnterBack: (group) => landGroup(onScreen(group)),
  })
}

// A decade row scrolls sideways and clips its cards, so it gets a sideways batch of its own, made
// once the row itself comes into view; until then its cards wait.
const shownRows = new WeakSet<Element>()
const watchedRows = new WeakSet<Element>()

function watchSideways(row: Element, cards: HTMLElement[]) {
  ScrollTrigger.batch(cards, {
    scroller: row,
    horizontal: true,
    start: `${RATIO * 100}% right`,
    end: `${(1 - RATIO) * 100}% left`,
    interval: 0.05,
    onEnter: landGroup,
    onEnterBack: landGroup,
  })
}

function watchRows(cards: HTMLElement[]) {
  const rows = new Map<Element, HTMLElement[]>()
  for (const card of cards)
    rows.set(card.parentElement!, [...(rows.get(card.parentElement!) ?? []), card])
  for (const [row, rowCards] of rows) {
    if (shownRows.has(row)) watchSideways(row, rowCards)
    else if (!watchedRows.has(row)) {
      watchedRows.add(row)
      const show = () => {
        if (shownRows.has(row) || !ScrollTrigger.isInViewport(row, 0.01)) return
        shownRows.add(row)
        const waiting = [...row.children].filter((card) => landOf(card as HTMLElement) === 'wait')
        watchSideways(row, waiting as HTMLElement[])
      }
      ScrollTrigger.create({
        trigger: row,
        start: START,
        end: END,
        onEnter: show,
        onEnterBack: show,
      })
    }
  }
}

export function startGsap() {
  watchParts((parts) => {
    parts.forEach((part) => setLand(part, 'wait'))
    const sideways = (part: HTMLElement) =>
      part.matches('.ab-strip-item') && !part.parentElement!.matches('.ab-strip-grid')
    watchDown(parts.filter((part) => !sideways(part)))
    watchRows(parts.filter(sideways))
  })

  // Keyboard focus lands a part at once (parts.ts): stop its slam where it is.
  landOnFocus(clear)

  // Reduced motion, asked for mid-slam by the device or the site: stop every slam, still.
  const calm = () => {
    if (reducedMotion()) for (const part of [...timelines.keys()]) finish(part)
  }
  new MutationObserver(calm).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-motion'],
  })
  watchDeviceMotion(calm)

  // ScrollTrigger measures only on a window resize: measure again whenever the page's height
  // changes, and forget triggers whose parts have left the page.
  let queued = 0
  new ResizeObserver(() => {
    cancelAnimationFrame(queued)
    queued = requestAnimationFrame(() => {
      for (const trigger of ScrollTrigger.getAll())
        if (trigger.trigger && !trigger.trigger.isConnected) trigger.kill()
      ScrollTrigger.refresh()
    })
  }).observe(document.body)
}
