// What the lab reads off a drawn page: Tab stops and what a screen reader would read.

/** Focusable elements on the stage's page: what a Tab walk would stop at. */
export function tabStops(root: Element) {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(
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
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
}
