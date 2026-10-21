import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  formatOf,
  nextEpisode,
  runtimeOf,
  seasonOf,
  studioOf,
  titleOf,
} from '../features/anime/format.ts'
import type { Media } from '../features/anime/queries.ts'
import { trailerOf } from '../features/anime/trailer.ts'
import { accentVars } from '../features/theming/deriveAccent.ts'
import { reducedMotion, watchDeviceMotion } from '../lib/motion.ts'
import { dropTrailer, isTrailer, pushTrailer } from '../lib/route.ts'
import { markBroken, markLoaded } from './cover.ts'
import { cssVars } from './cssVars.ts'
import { RetryButton } from './RetryButton.tsx'
import { TitleDetails } from './TitleDetails.tsx'
import { TrailerDialog } from './TrailerDialog.tsx'

/** Called with the title and the element it was opened from (for the opening animation). */
export type OpenTitle = (media: Media, from: HTMLElement) => void

/**
 * A title's full-screen card: its color floods the screen with speed lines, then the card
 * lands and the title slams in word by word, and closing plays all that backwards (reduced
 * motion: it fades in, and fades out as it closes). It opens as a native modal dialog, so the
 * page behind goes inert, Esc closes it, and the browser returns focus to whatever opened it.
 * `from` is that element's position, where the wipe starts, and where it shrinks back to.
 * `status` says why AniList holds up a newer answer for the title, and `onRetry` is Try again.
 * Where the title has a trailer it can play, Watch trailer plays it over the card (TrailerDialog).
 */
export function TitleCard({
  media,
  from,
  status = null,
  onRetry,
  onClose,
}: {
  media: Media
  from: DOMRect
  status?: string | null
  onRetry?: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // Try again hands focus to the status line as it hides (see RetryButton). Once the answer has
  // come and the line has nothing more to say, focus goes on to the close button, where the card
  // started it, rather than staying on a line no longer shown; the card keeps its place.
  const closeButton = useRef<HTMLButtonElement>(null)
  const statusLine = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    if (!status && document.activeElement === statusLine.current)
      closeButton.current?.focus({ preventScroll: true })
  }, [status])
  // The status line sticks to the screen's foot over the card's parts, so the card keeps its height
  // (--status-h) for the space a part the keyboard focuses scrolls clear of (see .ab-card's
  // scroll-padding-bottom): none is hidden under the line (WCAG 2.4.11), nor out of a click's reach.
  const statusBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const card = ref.current
    const line = statusBox.current
    if (!card || !line) return
    const resized = new ResizeObserver(() =>
      card.style.setProperty('--status-h', `${line.offsetHeight}px`),
    )
    resized.observe(line)
    return () => resized.disconnect()
  }, [])
  // With reduced motion, the card fades out before it closes (see .ab-card.is-closing): the
  // dialog stays open while the fade plays, and closes as it ends, when the browser returns
  // focus. Asked to close again meanwhile, it closes at once.
  const [closing, setClosing] = useState(false)
  const fadesOut = () => !closing && reducedMotion()
  // With motion allowed, the card plays its opening backwards before it closes (see
  // .ab-card.is-leaving): the dialog stays open while it plays, and closes as the wipe, last to
  // go, ends. Asked to close again meanwhile, it closes at once.
  const [leaving, setLeaving] = useState(false)
  // Asked to close before it has finished opening, the card turns its opening around where it is
  // instead (see leave()): turning holds it open meanwhile.
  const turning = useRef(false)
  const playsBack = () => !closing && !leaving && !turning.current && !reducedMotion()

  // Landed: the card has finished opening, its wipe and slam played (its fade, under reduced
  // motion). The close button's look for the keyboard's focus waits for it (see
  // .ab-card.is-landed), so that it plays on a card already on screen.
  const [landed, setLanded] = useState(false)

  // No cleanup for the dialog: removing the element closes it. The landing is heard only while
  // this effect is the one that counts (StrictMode runs it twice).
  useEffect(() => {
    const card = ref.current
    if (!card) return
    if (!card.open) card.showModal()
    let current = true
    const opening = card
      .getAnimations({ subtree: true })
      .filter(
        (animation) =>
          animation.timeline === document.timeline &&
          animation.effect?.getComputedTiming().endTime !== Infinity,
      )
    void Promise.allSettled(opening.map((animation) => animation.finished)).then(() => {
      if (current && !turning.current) setLanded(true)
    })
    return () => {
      current = false
    }
  }, [])

  // With no fade to end, as when a stylesheet of the visitor's own turns animations off, the card
  // would stay open for good, so it closes once the fade's 150 ms are up. Asking for its
  // animations brings its styles up to date first, so a fade that runs is there to find.
  useEffect(() => {
    const card = ref.current
    if (!closing || !card || card.getAnimations().length > 0) return
    const timer = window.setTimeout(() => card.close(), 150)
    return () => clearTimeout(timer)
  }, [closing])

  // With no way back to play, as when a stylesheet of the visitor's own turns animations off, the
  // card closes at once. Asking for the wipe's animations brings its styles up to date first, so
  // a way back that plays is there to find. And if the device starts asking for reduced motion
  // mid-way, the motion gate closes and the way back stops before it ends, so the card closes at
  // once then too, rather than staying open. (The site's own switch is out of reach meanwhile:
  // the card is modal.)
  useEffect(() => {
    const card = ref.current
    const wipe = card?.querySelector('.ab-wipe')
    if (!leaving || !card || !wipe) return
    if (wipe.getAnimations().length === 0) return card.close()
    return watchDeviceMotion(() => {
      if (reducedMotion()) card.close()
    })
  }, [leaving])

  // With motion allowed, closing plays the way back. Before the card has landed, its opening is
  // turned around where it is instead, at twice its speed, rather than snapping open to play the
  // whole way back, and the dialog closes as it gets back to its start. Every part started
  // together, so they all go back from one moment, how far the longest still running had got: a
  // part that had already finished rests at its own end, and waits there until the way back
  // reaches it. With nothing played yet, it closes at once; with everything played (landed, as
  // React hasn't drawn yet), the way back plays. Animations cut short meanwhile, as reduced motion
  // asked for mid-way would, count as back too.
  function leave() {
    const card = ref.current
    if (!card) return
    if (landed) return setLeaving(true)
    const opening = card
      .getAnimations({ subtree: true })
      .filter(
        (animation) =>
          animation instanceof CSSAnimation &&
          animation.timeline === document.timeline &&
          animation.effect?.getComputedTiming().endTime !== Infinity,
      )
    const reached = Math.max(0, ...opening.map((animation) => Number(animation.currentTime ?? 0)))
    if (reached === 0) return card.close()
    if (opening.every((animation) => animation.playState === 'finished')) return setLeaving(true)
    turning.current = true
    const now = Number(document.timeline.currentTime)
    for (const animation of opening) {
      animation.playbackRate = -2
      animation.startTime = now + reached / 2
    }
    void Promise.allSettled(opening.map((animation) => animation.finished)).then(() => card.close())
  }

  // The title's trailer, where it has one the card can play (see trailerOf), and whether it is
  // playing over the card. Pressing Watch trailer adds a history entry at the card's address (see
  // pushTrailer), so Back closes the trailer and leaves the card, and Forward back to it opens the
  // trailer again, as Forward does a card. A card opened at such an entry, as after a reload there,
  // opens without its trailer: only a press loads anything from YouTube (spec §5).
  const trailer = trailerOf(media)
  const [watching, setWatching] = useState(false)
  const watchButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    dropTrailer()
    const moved = () => {
      if (isTrailer(history.state)) setWatching(true)
    }
    addEventListener('popstate', moved)
    return () => removeEventListener('popstate', moved)
  }, [])
  // Closed, the trailer goes, its video with it, and focus goes back to Watch trailer, as the dialog
  // hands it back where the press focused the button (Safari focuses no button it clicks). Closed by
  // its own Close, Esc or a click around it, its history entry goes too, so Back then closes the
  // card (and a card that closes meanwhile waits for it: see App).
  const closeTrailer = () => {
    setWatching(false)
    watchButton.current?.focus({ preventScroll: true })
    if (isTrailer(history.state)) history.back()
  }

  function close() {
    if (fadesOut()) setClosing(true)
    else if (playsBack()) leave()
    else ref.current?.close()
  }

  const title = titleOf(media)
  const size = title.length > 44 ? 'ab-xl' : title.length > 22 ? 'ab-l' : ''
  const next = nextEpisode(media)
  const runtime = runtimeOf(media)
  return (
    <dialog
      ref={ref}
      className={[
        'ab-card',
        landed && 'is-landed',
        closing && 'is-closing',
        leaving && 'is-leaving',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby="ab-card-title"
      // Esc closes the card unless the page holds it open, which the browser allows once for each
      // thing the visitor does on the page: the cancel event is cancelable then. The trailer's
      // dialog sits in the card, and React hands its cancel and close events to the card's own
      // handlers too, so they count only the card's.
      onCancel={(event) => {
        if (event.target !== event.currentTarget || !event.cancelable) return
        if (fadesOut()) setClosing(true)
        else if (playsBack()) leave()
        else return
        event.preventDefault()
      }}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) event.currentTarget.close()
        if (leaving && event.animationName === 'ab-wipe-back') event.currentTarget.close()
      }}
      onClose={(event) => event.target === event.currentTarget && onClose()}
      style={{
        ...accentVars(media.coverImage.color),
        ...cssVars({
          '--t': `${Math.max(0, from.top)}px`,
          '--l': `${Math.max(0, from.left)}px`,
          '--r': `${Math.max(0, innerWidth - from.right)}px`,
          '--b': `${Math.max(0, innerHeight - from.bottom)}px`,
          // The title's words, which land one after another: the closing's timing counts them.
          '--n': title.split(' ').length,
        }),
      }}
    >
      {/* The tab's title while the card is open: React 19 puts it in the page's head. */}
      <title>{`${title} · AniBeam`}</title>
      <div className="ab-wipe" aria-hidden="true" />
      <article className="ab-sheet">
        <button
          ref={closeButton}
          type="button"
          className="ab-close"
          onClick={close}
          aria-label="Close title card"
        >
          {/* An X of three bars, so it can fold into a back arrow (see .ab-x). */}
          <span className="ab-x" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>
        {/* The banner band (see .ab-band): the title's banner, where it has one, over its color.
            Decoded off the main thread, so a large banner landing mid-opening holds up nothing. */}
        <div className="ab-band" aria-hidden="true">
          {media.bannerImage && (
            <img
              src={media.bannerImage}
              alt=""
              decoding="async"
              onLoad={markLoaded}
              onError={markBroken}
            />
          )}
        </div>
        <div className="ab-sheet-art">
          {media.title.native && (
            <p className="ab-native" lang="ja" aria-hidden="true">
              {media.title.native}
            </p>
          )}
          <img src={media.coverImage.extraLarge} alt="" onLoad={markLoaded} onError={markBroken} />
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
            {runtime && (
              <div>
                <dt>Runtime</dt>
                <dd>
                  <span aria-hidden="true">{runtime.text}</span>
                  <span className="sr-only">{runtime.spoken}</span>
                </dd>
              </div>
            )}
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
            {trailer && (
              <button
                ref={watchButton}
                type="button"
                className="ab-btn"
                onClick={() => {
                  pushTrailer()
                  setWatching(true)
                }}
              >
                <svg className="ab-play" viewBox="0 0 11 13" aria-hidden="true">
                  <path d="M0 0 11 6.5 0 13Z" />
                </svg>
                Watch trailer
              </button>
            )}
          </div>
          <TitleDetails media={media} />
        </div>
      </article>
      {/* Why AniList holds up a newer answer for the title (spec §3I), which the card keeps
          meanwhile, with Try again once the tries end. It sits past the sheet's end, so nothing
          moves as it comes, and sticks to the screen's foot while the card scrolls (see
          .ab-card-status). The line is always there, so a screen reader hears it change. */}
      <div ref={statusBox} className={status ? 'ab-card-status is-shown' : 'ab-card-status'}>
        <p ref={statusLine} id="ab-card-status" role="status" tabIndex={-1}>
          {status}
        </p>
        {status && onRetry && <RetryButton headingId="ab-card-status" onRetry={onRetry} />}
      </div>
      {watching && trailer && <TrailerDialog id={trailer} title={title} onClose={closeTrailer} />}
    </dialog>
  )
}
