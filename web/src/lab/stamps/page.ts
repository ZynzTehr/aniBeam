// What the stamps lab watches on its stage: requests to AniList's API, which it refuses and counts;
// the page's Tab stops; what a screen reader reads for a cover; and layout shift.

let refused = 0

/**
 * Refuses every request to AniList's API, and counts it: the lab draws from bundled titles only,
 * so the count must stay 0. Covers still come from AniList's image server, as on the site.
 */
export function guardFetch() {
  const real = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (/(^|\/\/)graphql\.anilist\.co/.test(url)) {
      refused++
      return Promise.reject(new TypeError('The stamps lab sends AniList nothing.'))
    }
    return real(input, init)
  }
}

/** How many requests to AniList's API the lab has refused on this page. */
export const refusedRequests = () => refused

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** Focusable elements under `root`: what a Tab walk would stop at. */
export function tabStops(root: Element) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      element.getClientRects().length > 0 &&
      !element.closest('[inert], [aria-hidden="true"]') &&
      getComputedStyle(element).visibility !== 'hidden',
  )
}

/** What a screen reader reads for a link: its text, leaving out what is hidden from it. */
export function spokenName(link: Element) {
  const copy = link.cloneNode(true) as Element
  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove())
  // A space after each element, as a screen reader leaves between blocks.
  copy.querySelectorAll('*').forEach((part) => part.append(' '))
  return (copy.textContent ?? '')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.])/g, '$1')
    .trim()
}

/** The links a cover is: on trending, strips and search, My List, the matches and the roll. */
export const COVERS = '.ab-link, .ab-strip-panel[href], .ab-match, .ab-result-panel'

/**
 * Layout shift since the last call to `reset`, as Chrome reports it, leaving out shifts just after
 * input. Where the browser has no such report, it reads null.
 */
export function watchShift() {
  let total = 0
  // Safari and Firefox have no layout-shift entries.
  const supported = PerformanceObserver.supportedEntryTypes?.includes('layout-shift') ?? false
  if (supported)
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number
        hadRecentInput: boolean
      })[])
        if (!entry.hadRecentInput) total += entry.value
    }).observe({ type: 'layout-shift' })
  return {
    read: () => (supported ? total : null),
    reset: () => void (total = 0),
  }
}
