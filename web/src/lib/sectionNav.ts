/**
 * The page's section links (spec §5, the design signed off from draft #22): the header marks the
 * section the visitor is in. Its rules are pure functions, so unit tests hold them without a
 * browser; startSectionNav applies them to the page.
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

/**
 * Follows the section the visitor is in as the page scrolls, resizes or changes, and hands its
 * link's address (#pull, say) to `onCurrent` each time it changes, null above the first section.
 * Returns a stop.
 */
export function startSectionNav({
  header,
  onCurrent,
}: {
  header: HTMLElement
  onCurrent: (href: string | null) => void
}) {
  let current: string | null | undefined
  let frame = 0
  const evaluate = () => {
    frame = 0
    const tops = SECTIONS.map(
      (id) => document.getElementById(id)?.closest('section')?.getBoundingClientRect().top,
    )
    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 1
    const line = sectionLine(header.getBoundingClientRect().bottom, innerHeight)
    const index = currentSection(tops, line, atEnd && scrollY > 0)
    const next = index < 0 ? null : `#${SECTIONS[index]}`
    if (next === current) return
    current = next
    onCurrent(next)
  }
  // At most once a frame, however many scroll events come.
  const soon = () => {
    if (!frame) frame = requestAnimationFrame(evaluate)
  }
  addEventListener('scroll', soon, { passive: true })
  addEventListener('resize', soon)
  // Sections change size as titles load and lists change, moving those below them.
  const sizes = new ResizeObserver(soon)
  sizes.observe(header)
  const main = document.querySelector('main')
  if (main) sizes.observe(main)
  evaluate()
  return () => {
    removeEventListener('scroll', soon)
    removeEventListener('resize', soon)
    sizes.disconnect()
    cancelAnimationFrame(frame)
  }
}
