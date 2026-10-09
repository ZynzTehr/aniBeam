import type { ReactNode } from 'react'
import { seasonOf, titleOf } from '../features/anime/format.ts'
import type { Media } from '../features/anime/queries.ts'
import { cssVars } from './cssVars.ts'
import { opener } from './opener.ts'
import { SfxHeading } from './SfxHeading.tsx'
import type { OpenTitle } from './TitleCard.tsx'

/** A row of cover panels that scrolls sideways, numbered like manga chapters. */
export function Strip({
  id,
  heading,
  sfx,
  titles,
  onOpen,
  note = null,
  loading = false,
  onRetry,
  grid = false,
  children,
}: {
  id: string
  heading: string
  sfx: string
  titles: Media[]
  onOpen?: OpenTitle
  /** A status line (loading, error, rate limit), or null when there's nothing to say. */
  note?: string | null
  /** Show empty cards while the first load runs. */
  loading?: boolean
  /** Shown as a Try again button after a failed load. */
  onRetry?: () => void
  /** Wrap into rows instead of scrolling sideways (search results). */
  grid?: boolean
  /** Controls shown between the heading and the row, such as the decade chips. */
  children?: ReactNode
}) {
  const row = grid ? 'ab-strip-row ab-strip-grid' : 'ab-strip-row'
  return (
    <section className="ab-strip" aria-labelledby={id}>
      <SfxHeading id={id} sfx={sfx} small>
        {heading}
      </SfxHeading>
      {children}
      <p role="status" className="ab-note">
        {note}
      </p>
      {onRetry && (
        <button type="button" className="ab-btn ab-retry" onClick={onRetry}>
          Try again
        </button>
      )}
      {!titles.length && loading && (
        <ol className={row} aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="ab-strip-item">
              <span className="ab-strip-panel ab-skeleton-fill" />
            </li>
          ))}
        </ol>
      )}
      <ol className={row}>
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
