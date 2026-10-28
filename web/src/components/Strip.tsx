import { useLayoutEffect, useRef, type FocusEvent, type ReactNode } from 'react'
import { coverSrcSet, seasonOf, titleOf } from '../features/anime/format.ts'
import type { Media } from '../features/anime/queries.ts'
import { markBroken, markLoaded } from './cover.ts'
import { cssVars } from './cssVars.ts'
import { opener } from './opener.ts'
import { RetryButton } from './RetryButton.tsx'
import { SfxHeading } from './SfxHeading.tsx'
import type { OpenTitle } from './TitleCard.tsx'
import { titlePath } from '../lib/route.ts'

/** A row of cover panels that scrolls sideways, numbered like manga chapters. */
export function Strip({
  id,
  heading,
  sfx,
  titles,
  list,
  onOpen,
  level = 'h2',
  note = null,
  action,
  loading = false,
  onRetry,
  live = true,
  grid = false,
  inPlaceOf,
  children,
}: {
  id: string
  heading: string
  sfx: string
  /**
   * The titles, in order. Null holds a title's place with an empty card while it loads, as on My
   * List, where titles another answer brought already show in theirs; and words, on a plain card,
   * one whose details there are none of to show, as My List's "Details unavailable offline".
   */
  titles: readonly (Media | string | null)[]
  /**
   * Which list the titles are, such as a decade. A different list opens at Ch.1, so change it as
   * the new list's titles arrive, not while the last list's stand in for them. The same list is
   * never sent back to Ch.1, even when a refresh reorders its titles.
   */
  list?: string
  onOpen?: OpenTitle
  /** The heading's level: h1 where the strip takes the intro's place, as search results do. */
  level?: 'h1' | 'h2'
  /** A status line (loading, error, rate limit), or null when there's nothing to say. */
  note?: string | null
  /**
   * Show empty cards while the first load runs: one for each place in `titles` when it holds only
   * nulls, else 8.
   */
  loading?: boolean
  /** Shown as a Try again button after a failed load. */
  onRetry?: () => void
  /** Wrap into rows instead of scrolling sideways (search results). */
  grid?: boolean
  /** What shows in a title's place instead of its cover, if anything: My List's Undo. */
  inPlaceOf?: (media: Media) => ReactNode
  /** Controls shown between the heading and the row, such as the decade chips. */
  children?: ReactNode
} & (
  | {
      /** Announce the note to screen readers (off where another line announces it). */
      live?: true
      action?: undefined
    }
  | {
      live: false
      /**
       * A link after the note, in its line, as a search with no titles offers the mood sliders.
       * Only on a strip whose note isn't a live region, as a live region's text holds no link.
       */
      action?: ReactNode
    }
)) {
  const row = grid ? 'ab-strip-row ab-strip-grid' : 'ab-strip-row'
  // Waiting for its first titles, the strip shows empty cards, and its status line shows as a tag
  // over them instead of in a line of its own, so nothing moves as it clears (see .is-tagged). With
  // some titles already in their places, the empty cards among them say it, and the line takes no
  // room either.
  const waiting = loading && !titles.some(Boolean)
  const tagged = waiting || (loading && titles.includes(null))
  // A different list opens at Ch.1: React keeps this row for the next list, which would otherwise
  // open wherever the last one was scrolled. Keyed on which list it is, not on its titles, so a
  // refresh that reorders the list on screen doesn't send the visitor back to Ch.1, taking a
  // panel focused by keyboard out of view. Before paint, so no frame shows the new titles at the
  // old place.
  const titlesRow = useRef<HTMLOListElement>(null)
  useLayoutEffect(() => {
    titlesRow.current?.scrollTo({ left: 0, behavior: 'instant' })
  }, [list])
  return (
    <section className="ab-strip" aria-labelledby={id}>
      <SfxHeading as={level} id={id} sfx={sfx} small>
        {heading}
      </SfxHeading>
      {children}
      <p role={live ? 'status' : undefined} className={tagged ? 'ab-note is-tagged' : 'ab-note'}>
        {note}
        {action && <> {action}</>}
      </p>
      {onRetry && <RetryButton headingId={id} onRetry={onRetry} />}
      {waiting && (
        // The tag sits over the cards, across as many as its note needs: inside the first, which
        // clips what it holds, a long note was cut off, as a phone's card is 150px wide.
        <div className="ab-strip-wait">
          <ol className={row} aria-hidden="true">
            {Array.from({ length: titles.length || 8 }, (_, i) => (
              <li key={i} className="ab-strip-item">
                <span className="ab-strip-panel ab-skeleton-fill" />
              </li>
            ))}
          </ol>
          <span className="ab-note-tag" aria-hidden="true">
            {note}
          </span>
        </div>
      )}
      <ol ref={titlesRow} className={row} onFocus={grid ? undefined : revealFocused}>
        {(waiting ? [] : titles).map((media, i) =>
          media === null ? (
            // Not a part that lands (see lib/landing.ts): the title that takes its place does.
            <li key={`wait-${i}`} aria-hidden="true">
              <span className="ab-strip-panel ab-skeleton-fill" />
            </li>
          ) : typeof media === 'string' ? (
            // Nor this: the title, should its details come, lands in its place.
            <li key={`words-${i}`}>
              <span className="ab-strip-panel ab-strip-words">{media}</span>
            </li>
          ) : (
            <li key={media.id} className="ab-strip-item" style={cssVars({ '--i': i })}>
              {inPlaceOf?.(media) ?? (
                <a
                  className="ab-strip-panel"
                  href={titlePath(media.id)}
                  onClick={opener(media, onOpen)}
                >
                  <img
                    src={media.coverImage.large}
                    srcSet={coverSrcSet(media)}
                    alt=""
                    loading="lazy"
                    onLoad={markLoaded}
                    onError={markBroken}
                  />
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
              )}
            </li>
          ),
        )}
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
