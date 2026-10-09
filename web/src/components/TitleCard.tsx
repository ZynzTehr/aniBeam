import { Fragment, useEffect, useRef } from 'react'
import { formatOf, nextEpisode, seasonOf, studioOf, titleOf } from '../features/anime/format.ts'
import type { Media } from '../features/anime/queries.ts'
import { accentVars } from '../features/theming/deriveAccent.ts'
import { cssVars } from './cssVars.ts'

/** Called with the title and the element it was opened from (for the opening animation). */
export type OpenTitle = (media: Media, from: HTMLElement) => void

/**
 * A title's full-screen card: its color floods the screen with speed lines, then the card
 * lands and the title slams in word by word (reduced motion: it simply appears). It opens as
 * a native modal dialog, so the page behind goes inert, Esc closes it, and the browser returns
 * focus to whatever opened it. `from` is that element's position, where the wipe starts.
 */
export function TitleCard({
  media,
  from,
  onClose,
}: {
  media: Media
  from: DOMRect
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  // No cleanup: removing the element closes the dialog.
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  const title = titleOf(media)
  const size = title.length > 44 ? 'ab-xl' : title.length > 22 ? 'ab-l' : ''
  const next = nextEpisode(media)
  return (
    <dialog
      ref={ref}
      className="ab-card"
      aria-labelledby="ab-card-title"
      onClose={onClose}
      style={{
        ...accentVars(media.coverImage.color),
        ...cssVars({
          '--t': `${Math.max(0, from.top)}px`,
          '--l': `${Math.max(0, from.left)}px`,
          '--r': `${Math.max(0, innerWidth - from.right)}px`,
          '--b': `${Math.max(0, innerHeight - from.bottom)}px`,
        }),
      }}
    >
      <div className="ab-wipe" aria-hidden="true" />
      <article className="ab-sheet">
        <button
          type="button"
          className="ab-close"
          onClick={() => ref.current?.close()}
          aria-label="Close title card"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <div className="ab-sheet-art">
          {media.title.native && (
            <p className="ab-native" lang="ja" aria-hidden="true">
              {media.title.native}
            </p>
          )}
          <img src={media.coverImage.extraLarge} alt="" />
        </div>
        <div className="ab-sheet-copy">
          <p className="ab-kicker">
            {[seasonOf(media), formatOf(media), studioOf(media)].filter(Boolean).join(' · ')}
          </p>
          <h2 id="ab-card-title" className={`ab-title ${size}`}>
            {title.split(' ').map((word, w) => (
              <Fragment key={w}>
                <span style={cssVars({ '--w': w })}>{word}</span>{' '}
              </Fragment>
            ))}
          </h2>
          {media.genres.length > 0 && (
            <ul className="ab-genres" aria-label="Genres">
              {media.genres.slice(0, 4).map((genre) => (
                <li key={genre}>{genre}</li>
              ))}
            </ul>
          )}
          <dl className="ab-facts">
            <div>
              <dt>Score</dt>
              <dd>{media.averageScore === null ? 'Not rated yet' : `${media.averageScore}%`}</dd>
            </div>
            <div>
              <dt>Episodes</dt>
              <dd>{media.episodes ?? 'TBA'}</dd>
            </div>
            {next && (
              <div>
                <dt>Next</dt>
                <dd>{next}</dd>
              </div>
            )}
          </dl>
          <div className="ab-row-actions">
            <a
              className="ab-btn ab-btn-ink"
              href={`https://anilist.co/anime/${media.id}`}
              target="_blank"
              rel="noreferrer"
            >
              Open on AniList
            </a>
            <button type="button" className="ab-soon" disabled>
              Save to My List <small>Soon</small>
            </button>
            <button type="button" className="ab-soon" disabled>
              Chat about it <small>Soon</small>
            </button>
          </div>
        </div>
      </article>
    </dialog>
  )
}
