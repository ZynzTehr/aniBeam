import type { Ref } from 'react'
import { episodesOf, formatOf, seasonOf, titleOf } from '../features/anime/format.ts'
import type { Media } from '../features/anime/queries.ts'
import { accentVars } from '../features/theming/deriveAccent.ts'
import { markBroken } from './cover.ts'
import { cssVars } from './cssVars.ts'
import { opener } from './opener.ts'
import { RetryButton } from './RetryButton.tsx'
import { SfxHeading } from './SfxHeading.tsx'
import type { OpenTitle } from './TitleCard.tsx'

// Desktop placement of the first nine panels: [column span of 12, row span]. Rank 1 is the
// splash panel; panels 4 and 5 share a diagonal cut, like a manga action page.
const LAYOUT: [number, number][] = [
  [8, 4],
  [4, 2],
  [4, 2],
  [4, 3],
  [5, 3],
  [3, 3],
  [5, 3],
  [3, 3],
  [4, 3],
]

/** Ranked titles as a manga page: the higher the rank, the bigger the panel. */
export function MangaPage({
  id,
  heading,
  sfx,
  titles,
  titlesRef,
  onOpen,
  level = 'h2',
  ranked = true,
  note = null,
  loading = false,
  onRetry,
}: {
  id: string
  heading: string
  sfx: string
  titles: Media[]
  /** Gets the panels' list, so App can tell when they are on screen (see useSteadyList). */
  titlesRef?: Ref<HTMLOListElement>
  onOpen?: OpenTitle
  level?: 'h1' | 'h2'
  /** Number the panels by rank. Off for titles in no particular order, such as the samples. */
  ranked?: boolean
  /** A status line (loading, error, rate limit), or null when there's nothing to say. */
  note?: string | null
  /** Show empty panels while the first load runs. */
  loading?: boolean
  /** Shown as a Try again button after a failed load. */
  onRetry?: () => void
}) {
  return (
    <section className="ab-page" aria-labelledby={id}>
      <SfxHeading as={level} id={id} sfx={sfx}>
        {heading}
      </SfxHeading>
      <p role="status" className="ab-note">
        {note}
      </p>
      {onRetry && <RetryButton headingId={id} onRetry={onRetry} />}
      {titles.length ? (
        <ol ref={titlesRef} className="ab-grid">
          {titles.slice(0, LAYOUT.length).map((media, i) => (
            <Panel
              key={media.id}
              media={media}
              rank={i + 1}
              ranked={ranked}
              span={LAYOUT[i]}
              onOpen={onOpen}
            />
          ))}
        </ol>
      ) : (
        // Empty panels hold the page's shape until the titles arrive.
        loading && (
          <ol className="ab-grid" aria-hidden="true">
            {LAYOUT.map((span, i) => (
              <li
                key={i}
                className="ab-panel ab-skeleton"
                style={cssVars({ '--c': span[0], '--r': span[1] })}
              >
                <span className="ab-skeleton-fill" />
              </li>
            ))}
          </ol>
        )
      )}
    </section>
  )
}

function Panel({
  media,
  rank,
  ranked,
  span,
  onOpen,
}: {
  media: Media
  /** The panel's place on the page, which sets its size; shown only when `ranked`. */
  rank: number
  ranked: boolean
  span: [number, number]
  onOpen?: OpenTitle
}) {
  const splash = rank === 1
  const meta = [seasonOf(media), formatOf(media), episodesOf(media)].filter(Boolean).join(' · ')
  const cut = rank === 4 ? 'ab-cut-right' : rank === 5 ? 'ab-cut-left' : ''
  return (
    <li
      className={`ab-panel ${splash ? 'ab-splash' : ''} ${cut}`}
      style={{
        ...accentVars(media.coverImage.color),
        ...cssVars({ '--c': span[0], '--r': span[1], '--i': rank }),
      }}
    >
      <a className="ab-link" href={`#title-${media.id}`} onClick={opener(media, onOpen)}>
        <span className="ab-img">
          <picture>
            {splash && media.bannerImage && (
              <source media="(min-width: 900px)" srcSet={media.bannerImage} />
            )}
            <img
              src={media.coverImage.extraLarge}
              alt=""
              loading={rank <= 3 ? 'eager' : 'lazy'}
              onError={markBroken}
            />
          </picture>
        </span>
        <span className="ab-tone" aria-hidden="true" />
        <span className="ab-speed" aria-hidden="true" />
        {ranked && (
          <span className="ab-rank" aria-hidden="true">
            {rank}
          </span>
        )}
        {media.averageScore !== null && (
          <span className="ab-bubble" aria-hidden="true">
            {media.averageScore}%
          </span>
        )}
        <span className="ab-caption">
          {ranked && <span className="sr-only">Number {rank} trending: </span>}
          <b>{titleOf(media)}</b>
          <small>{meta}</small>
          {media.averageScore !== null && (
            <span className="sr-only">, scored {media.averageScore}%</span>
          )}
        </span>
      </a>
    </li>
  )
}
