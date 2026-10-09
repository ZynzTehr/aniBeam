// PROTOTYPE ONLY. Variant D, the chosen direction (2026-10-08): A's Manga Page for browsing,
// a gacha machine drawn in the same ink-and-paper style, and B's cinematic motion when a title
// opens. Interaction question: does opening a title feel right with mouse, keyboard, touch and
// reduced motion, and does the ink-style pull still feel like a gacha?
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  accent,
  formatOf,
  MOODS,
  nextEpisode,
  seasonOf,
  studioOf,
  titleOf,
  type Mood,
  type Show,
  type VariantProps,
} from './data.ts'
import { MangaHeader, ThrowbackStrip, TrendingPage, type OpenTitle } from './VariantA.tsx'
import './variant-d.css'

const vars = (values: Record<string, string | number>) => values as CSSProperties
const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function rarityOf(score: number | null) {
  if (score === null) return { key: 'mystery', label: 'Mystery', stars: '?', sfx: '!?' }
  if (score >= 85) return { key: 'ssr', label: 'SSR', stars: '★★★', sfx: 'SSR!!' }
  if (score >= 75) return { key: 'sr', label: 'SR', stars: '★★', sfx: 'SR!' }
  return { key: 'r', label: 'R', stars: '★', sfx: 'R' }
}

export default function VariantD({ shows, classics }: VariantProps) {
  const [opened, setOpened] = useState<{ show: Show; from: DOMRect } | null>(null)
  const pool = useMemo(() => [...shows, ...classics], [shows, classics])
  const open: OpenTitle = (show, from) => setOpened({ show, from: from.getBoundingClientRect() })

  return (
    <div className="va vd">
      <MangaHeader variant="D" />
      <main>
        <TrendingPage shows={shows} onOpen={open} />
        <PullMachine pool={pool} onOpen={open} />
        <ThrowbackStrip classics={classics} onOpen={open} />
      </main>
      <footer className="va-foot">Data from AniList · Prototype D, the chosen direction</footer>
      {opened && (
        <TitleCard
          key={opened.show.id}
          show={opened.show}
          from={opened.from}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  )
}

function PullMachine({ pool, onOpen }: { pool: Show[]; onOpen: OpenTitle }) {
  const [mood, setMood] = useState<Mood>('any')
  const [pulled, setPulled] = useState<Show | null>(null)
  const [pulls, setPulls] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const seen = useRef(new Set<number>())
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  function pull() {
    const wanted = MOODS[mood].genres
    const matches = pool.filter(
      (s) =>
        (wanted.length === 0 || s.genres.some((g) => wanted.includes(g))) &&
        !seen.current.has(s.id),
    )
    const from = matches.length ? matches : pool
    const choice = from[Math.floor(Math.random() * from.length)]
    seen.current.add(choice.id)
    clearTimeout(timer.current)
    setPulled(choice)
    setPulls((n) => n + 1)
    setRevealed(false)
    timer.current = window.setTimeout(() => setRevealed(true), prefersReducedMotion() ? 0 : 900)
  }

  const rarity = pulled ? rarityOf(pulled.averageScore) : null
  return (
    <section id="pull" className="vd-pull" aria-labelledby="vd-pull-title">
      <h2 id="vd-pull-title" className="va-sfx va-sfx-small">
        Pull a title
        <span aria-hidden="true">ガチャ!</span>
      </h2>
      <div className="vd-pull-row">
        <div className="vd-machine">
          <div className="vd-dome" aria-hidden="true">
            {pool.slice(0, 9).map((show, i) => (
              <span
                key={show.id}
                className="vd-capsule"
                style={vars({ '--cap': accent(show.coverImage.color, 'vivid'), '--i': i })}
              />
            ))}
          </div>
          <div className="vd-body">
            <fieldset className="vd-moods">
              <legend>Pick a vibe</legend>
              {(Object.keys(MOODS) as Mood[]).map((key) => (
                <label key={key} className="vd-chip">
                  <input
                    type="radio"
                    name="vd-mood"
                    value={key}
                    checked={mood === key}
                    onChange={() => setMood(key)}
                  />
                  <span>{MOODS[key].label}</span>
                </label>
              ))}
            </fieldset>
            <button type="button" className="vd-lever" onClick={pull}>
              <span>{pulls ? 'Again!' : 'Pull!'}</span>
            </button>
            <p className="vd-count">
              {pulls === 0
                ? 'No pulls yet'
                : `${pulls} ${pulls === 1 ? 'pull' : 'pulls'} this visit`}
            </p>
          </div>
        </div>

        <div className="vd-reveal" aria-live="polite">
          {pulled && rarity ? (
            <div
              key={pulls}
              className={`vd-result vd-${rarity.key} ${revealed ? 'is-open' : ''}`}
              style={vars({ '--accent': accent(pulled.coverImage.color, 'vivid') })}
            >
              <span className="vd-drop" aria-hidden="true">
                <span className="vd-half vd-top-half" />
                <span className="vd-half vd-bottom-half" />
              </span>
              {revealed && (
                <>
                  <span className="vd-burst" aria-hidden="true" />
                  <a
                    className="vd-result-panel"
                    href={`#show-${pulled.id}`}
                    onClick={(event) => {
                      event.preventDefault()
                      onOpen(pulled, event.currentTarget)
                    }}
                  >
                    <img src={pulled.coverImage.extraLarge} alt="" />
                    <span className="vd-sfx-tier" aria-hidden="true">
                      {rarity.sfx}
                    </span>
                    <span className="sr-only">Open the title card for {titleOf(pulled)}</span>
                  </a>
                  <div className="vd-result-copy">
                    <p className="vd-tier">
                      {rarity.label} {rarity.stars}
                    </p>
                    <h3>{titleOf(pulled)}</h3>
                    <p className="vd-result-meta">
                      {[seasonOf(pulled), formatOf(pulled), studioOf(pulled)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <div className="vd-row-actions">
                      <button
                        type="button"
                        className="vd-btn vd-btn-ink"
                        onClick={(event) => onOpen(pulled, event.currentTarget)}
                      >
                        Open title card
                      </button>
                      <button type="button" className="vd-btn">
                        Save to My List
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="vd-hint">
              Pick a vibe, then pull. Every capsule holds a real anime: this week&rsquo;s trending
              or a &rsquo;90s classic.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function TitleCard({ show, from, onClose }: { show: Show; from: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  // Open as a modal: the page behind goes inert, Esc closes it, and the browser returns
  // focus to the panel that opened it. No cleanup: removing the element closes the dialog.
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  const title = titleOf(show)
  const size = title.length > 44 ? 'vd-xl' : title.length > 22 ? 'vd-l' : ''
  const next = nextEpisode(show)
  return (
    <dialog
      ref={ref}
      className="vd-card"
      aria-labelledby="vd-card-title"
      onClose={onClose}
      style={vars({
        '--t': `${Math.max(0, from.top)}px`,
        '--l': `${Math.max(0, from.left)}px`,
        '--r': `${Math.max(0, innerWidth - from.right)}px`,
        '--b': `${Math.max(0, innerHeight - from.bottom)}px`,
        '--accent': accent(show.coverImage.color, 'vivid'),
      })}
    >
      <div className="vd-wipe" aria-hidden="true" />
      <article className="vd-sheet">
        <button
          type="button"
          className="vd-close"
          onClick={() => ref.current?.close()}
          aria-label="Close title card"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <div className="vd-sheet-art">
          {show.title.native && (
            <p className="vd-native" lang="ja" aria-hidden="true">
              {show.title.native}
            </p>
          )}
          <img src={show.coverImage.extraLarge} alt="" />
        </div>
        <div className="vd-sheet-copy">
          <p className="vd-kicker">
            {[seasonOf(show), formatOf(show), studioOf(show)].filter(Boolean).join(' · ')}
          </p>
          <h2 id="vd-card-title" className={`vd-title ${size}`}>
            {title.split(' ').map((word, w) => (
              <Fragment key={w}>
                <span style={vars({ '--w': w })}>{word}</span>{' '}
              </Fragment>
            ))}
          </h2>
          {show.genres.length > 0 && (
            <ul className="vd-genres" aria-label="Genres">
              {show.genres.slice(0, 4).map((genre) => (
                <li key={genre}>{genre}</li>
              ))}
            </ul>
          )}
          <dl className="vd-facts">
            <div>
              <dt>Score</dt>
              <dd>{show.averageScore === null ? 'Not rated yet' : `${show.averageScore}%`}</dd>
            </div>
            <div>
              <dt>Episodes</dt>
              <dd>{show.episodes ?? 'TBA'}</dd>
            </div>
            {next && (
              <div>
                <dt>Next</dt>
                <dd>{next}</dd>
              </div>
            )}
          </dl>
          <div className="vd-row-actions">
            <button type="button" className="vd-btn vd-btn-hot">
              Save to My List
            </button>
            <a
              className="vd-btn"
              href={`https://anilist.co/anime/${show.id}`}
              target="_blank"
              rel="noreferrer"
            >
              Open on AniList
            </a>
          </div>
        </div>
      </article>
    </dialog>
  )
}
