// Draft PR 3 (never merged): what both slam engines share. A part is something that lands, once,
// as it scrolls into view: a trending panel, a decade or search card (its list item, which the
// row snaps to and search results measure; the card inside it moves), the pull machine, or a
// section heading. The prototype finds them on the live page by their classes, so no component
// changes. Each carries data-land, which slam.css reads:
//   wait  not seen yet: see-through, still in its place and in the Tab order;
//   go    landing: the engine plays its slam;
//   done  landed, with no animation left, so moving it in the page (React reorders keyed items)
//         replays nothing.

export const PARTS =
  '.ab-grid:not([aria-hidden]) > .ab-panel, .ab-strip-row:not([aria-hidden]) > .ab-strip-item, .ab-machine, .ab-sfx'

export type Land = 'wait' | 'go' | 'done'

export const landOf = (part: HTMLElement) => part.dataset.land as Land | undefined

export function setLand(part: HTMLElement, land: Land) {
  part.dataset.land = land
}

/**
 * Calls `onParts` with the parts new to the page (none of them marked yet), in page order: those
 * there now, then each batch that arrives, as React draws titles, skeletons give way, or a decade
 * or a search changes. `onParts` must mark each part, or it comes round again. Returns a stop.
 */
export function watchParts(onParts: (parts: HTMLElement[]) => void) {
  const scan = () => {
    const fresh = [...document.querySelectorAll<HTMLElement>(PARTS)].filter((el) => !landOf(el))
    if (fresh.length) onParts(fresh)
  }
  const observer = new MutationObserver(scan)
  observer.observe(document.body, { childList: true, subtree: true })
  scan()
  return () => observer.disconnect()
}

/**
 * Keyboard focus never meets a part that is see-through or still moving: focus inside a part
 * lands it at once (done), and `onLanded` lets the engine stop anything it was playing there. The
 * listener runs in the capture phase, before the strip's own focus handler scrolls the row.
 */
export function landOnFocus(onLanded: (part: HTMLElement) => void) {
  const land = (event: FocusEvent) => {
    const part = (event.target as Element | null)?.closest?.<HTMLElement>('[data-land]')
    if (!part || landOf(part) === 'done') return
    setLand(part, 'done')
    onLanded(part)
  }
  document.addEventListener('focusin', land, true)
  return () => document.removeEventListener('focusin', land, true)
}

/**
 * The tuning knobs, from the address for trying values on a phone: &scale= (how big a panel
 * starts, 1.14), &tilt= (its starting tilt in degrees, -2.5) and &stagger= (milliseconds between
 * parts that come into view together, 90). Out-of-range values are ignored.
 */
export function applyKnobs(search: string) {
  const asked = new URLSearchParams(search)
  const knobs: [string, string, number, number, string][] = [
    ['scale', '--slam-scale', 1, 2, ''],
    ['tilt', '--slam-tilt', -15, 15, 'deg'],
    ['stagger', '--slam-stagger', 0, 400, 'ms'],
  ]
  for (const [name, property, min, max, unit] of knobs) {
    const value = Number(asked.get(name) ?? NaN)
    if (asked.has(name) && value >= min && value <= max)
      document.documentElement.style.setProperty(property, `${value}${unit}`)
  }
}
