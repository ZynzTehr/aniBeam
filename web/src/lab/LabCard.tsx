import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { markBroken, markLoaded } from '../components/cover.ts'
import { cssVars } from '../components/cssVars.ts'
import { formatOf, nextEpisode, seasonOf, studioOf, titleOf } from '../features/anime/format.ts'
import { accentVars } from '../features/theming/deriveAccent.ts'
import type { Options } from './choices.ts'
import { LabDetails } from './LabDetails.tsx'
import type { LabTitle } from './types.ts'

/**
 * The title card as the lab draws it: TitleCard's markup and classes, so components.css styles it
 * as the real card. Inline, it sits in the page on its wipe, still, so the choices can be switched
 * and compared; as the card, it opens as TitleCard does, a modal dialog whose wipe grows from the
 * button that opened it, and it closes at once (the real card's way back is not one of the
 * choices).
 */
export function LabCard({
  title,
  options,
  mode,
  from,
  late = false,
  onClose,
}: {
  title: LabTitle
  options: Options
  mode: 'inline' | 'card'
  /** Where the wipe starts, as the card. */
  from?: DOMRect
  /** The details not here yet, as while their request runs (see "Details arrive late"). */
  late?: boolean
  /** The close button: closes the card, or, inline, goes back to the lab's choices. */
  onClose: () => void
}) {
  const headingId = useId()
  const name = titleOf(title)
  const size = name.length > 44 ? 'ab-xl' : name.length > 22 ? 'ab-l' : ''
  const next = nextEpisode(title)
  const band = options.hero === 'band'
  const frameOnPhones = options.phone === 'frame'
  // Only a YouTube trailer plays (PR 15 checks its id); Attack on Titan's saved id ends in a tab.
  const trailer = title.trailer?.site === 'youtube' ? title.trailer.id.trim() : null
  const [trailerOpen, setTrailerOpen] = useState(false)
  const sheetClass = [
    'ab-sheet',
    band && 'ab-lab-banded',
    options.align === 'top' && 'ab-lab-top',
    options.kanji === 'now' && 'ab-lab-dela',
  ]
    .filter(Boolean)
    .join(' ')
  const sheet = (
    <article className={sheetClass}>
      <button
        type="button"
        className="ab-close"
        // As the card, it closes the dialog, so the browser returns focus to what opened it.
        onClick={(event) => {
          const dialog = event.currentTarget.closest('dialog')
          if (dialog) dialog.close()
          else onClose()
        }}
        aria-label={mode === 'card' ? 'Close title card' : 'Back to the lab’s choices'}
      >
        <span className="ab-x" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </button>
      {band && (
        // The band: the banner in an ink frame, over the impact frame, which shows where there is
        // no banner or it fails to load. The banner is a background, not an img: a phone with
        // "Impact frame only" hides it, and a hidden background is never downloaded, where React
        // sets an img's src before a <picture> could stop it.
        <div
          className={['ab-lab-band', frameOnPhones && 'ab-lab-frame-on-phones']
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        >
          {title.bannerImage && (
            <div
              className="ab-lab-banner"
              style={cssVars({ '--ab-lab-banner': `url("${title.bannerImage}")` })}
            />
          )}
        </div>
      )}
      <div className="ab-sheet-art">
        {title.title.native && (
          <p className="ab-native" lang="ja" aria-hidden="true">
            {title.title.native}
          </p>
        )}
        <img src={title.coverImage.extraLarge} alt="" onLoad={markLoaded} onError={markBroken} />
      </div>
      <div className="ab-sheet-copy">
        <p className="ab-kicker">
          {[seasonOf(title), formatOf(title), studioOf(title)].filter(Boolean).join(' · ')}
        </p>
        <h2 id={headingId} className={`ab-title ${size}`}>
          {name.split(' ').map((word, w) => (
            <Fragment key={w}>
              <span style={cssVars({ '--w': w })}>{word}</span>{' '}
            </Fragment>
          ))}
        </h2>
        {title.genres.length > 0 && (
          <ul className="ab-genres" aria-label="Genres">
            {title.genres.slice(0, 4).map((genre) => (
              <li key={genre}>{genre}</li>
            ))}
          </ul>
        )}
        <dl className="ab-facts">
          <div>
            <dt>Score</dt>
            <dd>{title.averageScore === null ? 'Not rated yet' : `${title.averageScore}%`}</dd>
          </div>
          <div>
            <dt>Episodes</dt>
            <dd>{title.episodes ?? 'TBA'}</dd>
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
            href={`https://anilist.co/anime/${title.id}`}
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
          {trailer && (
            <button type="button" className="ab-btn" onClick={() => setTrailerOpen(true)}>
              Watch trailer
            </button>
          )}
        </div>
        {!late && <LabDetails title={title} options={options} />}
      </div>
      {trailer && trailerOpen && <TrailerNote id={trailer} onClose={() => setTrailerOpen(false)} />}
    </article>
  )
  const style = {
    ...accentVars(title.coverImage.color),
    ...cssVars({
      '--t': `${Math.max(0, from?.top ?? 0)}px`,
      '--l': `${Math.max(0, from?.left ?? 0)}px`,
      '--r': `${Math.max(0, innerWidth - (from?.right ?? innerWidth))}px`,
      '--b': `${Math.max(0, innerHeight - (from?.bottom ?? innerHeight))}px`,
      '--n': name.split(' ').length,
    }),
  }
  if (mode === 'card')
    return (
      <CardDialog headingId={headingId} style={style} onClose={onClose}>
        {sheet}
      </CardDialog>
    )
  return (
    <section className="ab-lab-screen" style={style} aria-labelledby={headingId}>
      <div className="ab-wipe" aria-hidden="true" />
      {sheet}
    </section>
  )
}

/** The card as a modal dialog, as TitleCard opens it: Esc and Close close it at once. */
function CardDialog({
  headingId,
  style,
  onClose,
  children,
}: {
  headingId: string
  style: CSSProperties
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="ab-card is-landed"
      aria-labelledby={headingId}
      onClose={onClose}
      style={style}
    >
      <div className="ab-wipe" aria-hidden="true" />
      {children}
    </dialog>
  )
}

/**
 * What "Watch trailer" opens in the lab: the trailer's own dialog comes in PR 15, so this one,
 * in the title note's look, only shows its copy. It loads nothing from YouTube.
 */
function TrailerNote({ id, onClose }: { id: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])
  return (
    <dialog ref={ref} className="ab-notice" aria-labelledby={headingId} onClose={onClose}>
      <p id={headingId} className="ab-notice-text">
        The trailer plays here from PR 15.
      </p>
      <p className="ab-lab-why">
        Nothing loads from YouTube until it is pressed; if the video fails, this link shows:
      </p>
      <div className="ab-row-actions">
        <a
          className="ab-btn ab-btn-ink"
          href={`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`}
          target="_blank"
          rel="noreferrer"
        >
          Open on YouTube
        </a>
        <button type="button" className="ab-btn" onClick={() => ref.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  )
}
