import { useLayoutEffect, useRef, type FocusEvent, type ReactNode } from 'react'
import { seasonOf, titleOf } from '../features/anime/format.ts'
import type { Media } from '../features/anime/queries.ts'
import { cssVars } from './cssVars.ts'
import { opener } from './opener.ts'
import { RetryButton } from './RetryButton.tsx'
import { SfxHeading } from './SfxHeading.tsx'
import type { OpenTitle } from './TitleCard.tsx'

/** A row of cover panels that scrolls sideways, numbered like manga chapters. */
export function Strip({
  id,
  heading,
  sfx,
  titles,
  onOpen,
  level = 'h2',
  note = null,
  loading = false,
  onRetry,
  live = true,
  grid = false,
  children,
}: {
  id: string
  heading: string
  sfx: string
  titles: Media[]
  onOpen?: OpenTitle
  /** The heading's level: h1 where the strip takes the intro's place, as search results do. */
  level?: 'h1' | 'h2'
  /** A status line (loading, error, rate limit), or null when there's nothing to say. */
  note?: string | null
  /** Show empty cards while the first load runs. */
  loading?: boolean
  /** Shown as a Try again button after a failed load. */
  onRetry?: () => void
  /** Announce the note to screen readers (off where another line announces it). */
  live?: boolean
  /** Wrap into rows instead of scrolling sideways (search results). */
  grid?: boolean
  /** Controls shown between the heading and the row, such as the decade chips. */
  children?: ReactNode
}) {
  const row = grid ? 'ab-strip-row ab-strip-grid' : 'ab-strip-row'
  // A new list starts at Ch.1. React keeps this row for the next list, which would otherwise
  // open wherever the last one was scrolled. Keyed on the titles' ids, it runs when a new list's
  // titles arrive (not while the last list stands in for them) and never when the same list
  // renders again. Before paint, so no frame shows the new titles at the old place.
  const titlesRow = useRef<HTMLOListElement>(null)
  const ids = titles.map((media) => media.id).join()
  useLayoutEffect(() => {
    titlesRow.current?.scrollTo({ left: 0, behavior: 'instant' })
  }, [ids])
  return (
    <section className="ab-strip" aria-labelledby={id}>
      <SfxHeading as={level} id={id} sfx={sfx} small>
        {heading}
      </SfxHeading>
      {children}
      <p role={live ? 'status' : undefined} className="ab-note">
        {note}
      </p>
      {onRetry && <RetryButton headingId={id} onRetry={onRetry} />}
      {!titles.length && loading && (
        <ol className={row} aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="ab-strip-item">
              <span className="ab-strip-panel ab-skeleton-fill" />
            </li>
          ))}
        </ol>
      )}
      <ol ref={titlesRow} className={row} onFocus={grid ? undefined : revealFocused}>
        {titles.map((media, i) => (
          <li key={media.id} className="ab-strip-item" style={cssVars({ '--i': i })}>
            <a
              className="ab-strip-panel"
              href={`#title-${media.id}`}
              onClick={opener(media, onOpen)}
            >
              <img src={media.coverImage.large} alt="" loading="lazy" />
              {!grid && (
                <span className="ab-chapter" aria-hidden="true">
                  Ch.{i + 1}
                </span>
              )}
              <span className="ab-strip-title">
                <span>{titleOf(media)}</span>
              </span>
              <span className="sr-only">, {seasonOf(media)}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * Keyboard focus on a panel that only peeks into the row scrolls the row so the whole panel
 * and its focus ring show. Chrome leaves a partly shown panel where it is. The row snaps with
 * a panel at its start, so it moves to the nearest such place that shows the panel; anywhere
 * else would slide back. A mouse or touch press leaves the row still: it opens the title card.
 */
function revealFocused({ currentTarget: row, target: panel }: FocusEvent<HTMLElement>) {
  const item = panel.closest('li')
  if (!item || !panel.matches(':focus-visible')) return
  const room = parseFloat(getComputedStyle(row).scrollPaddingLeft)
  const { outlineWidth, outlineOffset } = getComputedStyle(panel)
  const ring = parseFloat(outlineWidth) + parseFloat(outlineOffset)
  // Places the row can rest, each with an item at its start. The row is the items'
  // offsetParent, so offsetLeft is a place in its content, whatever its scroll.
  const stops = [...row.children].map((li) => (li as HTMLElement).offsetLeft - room)
  const own = item.offsetLeft - room
  const end = item.offsetLeft + item.offsetWidth + ring - row.clientWidth
  if (item.offsetLeft - ring < row.scrollLeft) row.scrollTo({ left: own, behavior: 'instant' })
  else if (end > row.scrollLeft)
    row.scrollTo({ left: stops.find((stop) => stop >= end) ?? own, behavior: 'instant' })
}
