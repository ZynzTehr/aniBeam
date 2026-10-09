// PROTOTYPE ONLY. Variant C, "Gacha Board": the home screen is a table of collectible
// title cards, led by the gacha pull. Rarity comes from the AniList score.
import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import {
  accent,
  formatOf,
  MOODS,
  seasonOf,
  studioOf,
  titleOf,
  type Mood,
  type Show,
  type VariantProps,
} from './data.ts'
import './variant-c.css'

const vars = (values: Record<string, string | number>) => values as CSSProperties
const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function rarityOf(score: number | null) {
  if (score === null) return { key: 'mystery', label: 'Mystery', stars: '?' }
  if (score >= 85) return { key: 'ssr', label: 'SSR', stars: '★★★' }
  if (score >= 75) return { key: 'sr', label: 'SR', stars: '★★' }
  return { key: 'r', label: 'R', stars: '★' }
}

export default function VariantC({ shows, classics }: VariantProps) {
  const pool = useMemo(() => [...shows, ...classics], [shows, classics])
  const [mood, setMood] = useState<Mood>('any')
  const [pulled, setPulled] = useState<Show | null>(null)
  const [pulls, setPulls] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [history, setHistory] = useState<Show[]>([])
  const timer = useRef<number | undefined>(undefined)

  function pull() {
    const wanted = MOODS[mood].genres
    const seen = new Set(history.map((s) => s.id))
    const matches = pool.filter(
      (s) => (wanted.length === 0 || s.genres.some((g) => wanted.includes(g))) && !seen.has(s.id),
    )
    const from = matches.length ? matches : pool
    const choice = from[Math.floor(Math.random() * from.length)]
    clearTimeout(timer.current)
    setPulled(choice)
    setPulls((n) => n + 1)
    setRevealed(false)
    setHistory((h) => [choice, ...h.filter((s) => s.id !== choice.id)].slice(0, 10))
    timer.current = window.setTimeout(() => setRevealed(true), prefersReducedMotion() ? 0 : 950)
  }

  const rarity = pulled ? rarityOf(pulled.averageScore) : null
  return (
    <div className="vc">
      <header className="vc-top">
        <a className="vc-logo" href="?variant=C">
          <span className="vc-capsule-icon" aria-hidden="true" />
          AniBeam
        </a>
        <nav className="vc-nav" aria-label="Sections">
          <a href="?variant=C" aria-current="page">
            Pull
          </a>
          <a href="?variant=C#decks">Decks</a>
          <a href="?variant=C#list">My List</a>
        </nav>
        <label className="vc-search">
          <span className="sr-only">Search titles</span>
          <input type="search" placeholder="Search a title…" />
        </label>
      </header>

      <section className="vc-stage" aria-labelledby="vc-pull-title">
        <div className="vc-machine">
          <h1 id="vc-pull-title" className="vc-h1">
            Pull a title
            <span lang="ja" aria-hidden="true">
              ガチャ
            </span>
          </h1>
          <p className="vc-lede">
            Pick a vibe and pull. Every capsule holds a real trending or &rsquo;90s anime.
          </p>
          <fieldset className="vc-moods">
            <legend className="sr-only">Vibe</legend>
            {(Object.keys(MOODS) as Mood[]).map((key) => (
              <label key={key} className="vc-chip">
                <input
                  type="radio"
                  name="vc-mood"
                  value={key}
                  checked={mood === key}
                  onChange={() => setMood(key)}
                />
                <span>{MOODS[key].label}</span>
              </label>
            ))}
          </fieldset>
          <button type="button" className="vc-lever" onClick={pull}>
            <span>{pulls ? 'Pull again' : 'Pull!'}</span>
          </button>
          <div className="vc-window" aria-hidden="true">
            {pool.slice(0, 7).map((show, i) => (
              <span
                key={show.id}
                className="vc-capsule"
                style={vars({ '--cap': accent(show.coverImage.color, 'vivid'), '--i': i })}
              />
            ))}
          </div>
          <p className="vc-count">
            {pulls === 0
              ? 'No pulls yet this visit'
              : `${pulls} ${pulls === 1 ? 'pull' : 'pulls'} this visit`}
          </p>
        </div>

        <div className="vc-slot">
          {pulled && rarity ? (
            <div className="vc-result" key={pulls}>
              <div className={`vc-drop ${revealed ? 'is-open' : ''}`} aria-hidden="true">
                <span className="vc-half vc-top-half" />
                <span className="vc-half vc-bottom-half" />
              </div>
              <Card show={pulled} size="hero" faceUp={revealed} />
              <div className="vc-details" aria-live="polite">
                {revealed && (
                  <>
                    <p className={`vc-tier vc-${rarity.key}`}>
                      {rarity.label} · {rarity.stars}
                    </p>
                    <h2 className="vc-pulled-title">{titleOf(pulled)}</h2>
                    <p className="vc-pulled-meta">
                      {[seasonOf(pulled), formatOf(pulled), studioOf(pulled)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="vc-genres">{pulled.genres.slice(0, 3).join(' / ')}</p>
                    <div className="vc-actions">
                      <button type="button" className="vc-save">
                        Save to My List
                      </button>
                      <a className="vc-more" href={`#show-${pulled.id}`}>
                        Details
                      </a>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="vc-empty">
              <span className="vc-capsule-big" aria-hidden="true" />
              <p>Your capsule lands here.</p>
            </div>
          )}
        </div>
      </section>

      <div id="decks">
        <Deck
          id="vc-trending"
          title="Trending deck"
          note="This week's most-watched"
          shows={shows.slice(0, 9)}
        />
        <Deck
          id="vc-nineties"
          title="'90s deck"
          note="Classics that still hit"
          shows={classics.slice(0, 9)}
        />
        {history.length > 1 && (
          <Deck
            id="vc-history"
            title="Your pulls"
            note="Everything you pulled this visit"
            shows={history}
          />
        )}
      </div>
      <footer className="vc-foot">Data from AniList · Prototype C</footer>
    </div>
  )
}

function Deck({
  id,
  title,
  note,
  shows,
}: {
  id: string
  title: string
  note: string
  shows: Show[]
}) {
  const middle = (shows.length - 1) / 2
  return (
    <section className="vc-deck" aria-labelledby={id}>
      <h2 id={id} className="vc-h2">
        {title}
        <small>{note}</small>
      </h2>
      <ol className="vc-fan">
        {shows.map((show, i) => (
          <li
            key={show.id}
            style={vars({ '--i': i, '--off': i - middle, '--dist': Math.abs(i - middle) })}
          >
            <a href={`#show-${show.id}`} className="vc-card-link">
              <Card show={show} size="deck" faceUp />
              <span className="sr-only">
                {titleOf(show)}, {rarityOf(show.averageScore).label}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Card({ show, size, faceUp }: { show: Show; size: 'hero' | 'deck'; faceUp: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const rarity = rarityOf(show.averageScore)

  // Tilt and foil follow a mouse; touch and keyboard get the static card.
  function tilt(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || !ref.current) return
    const box = ref.current.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width
    const y = (event.clientY - box.top) / box.height
    ref.current.style.setProperty('--rx', `${(0.5 - y) * 16}deg`)
    ref.current.style.setProperty('--ry', `${(x - 0.5) * 20}deg`)
    ref.current.style.setProperty('--px', `${x * 100}%`)
    ref.current.style.setProperty('--py', `${y * 100}%`)
  }
  function settle() {
    for (const name of ['--rx', '--ry', '--px', '--py']) ref.current?.style.removeProperty(name)
  }

  return (
    <div
      ref={ref}
      className={`vc-card vc-${size} vc-${rarity.key} ${faceUp ? 'is-up' : ''}`}
      style={vars({ '--accent': accent(show.coverImage.color, 'dark') })}
      onPointerMove={tilt}
      onPointerLeave={settle}
      aria-hidden="true"
    >
      <div className="vc-flip">
        <div className="vc-face vc-front">
          <img
            src={size === 'hero' ? show.coverImage.extraLarge : show.coverImage.large}
            alt=""
            loading="lazy"
          />
          <span className="vc-foil" />
          <span className="vc-stars">{rarity.stars}</span>
          <span className="vc-name">{titleOf(show)}</span>
        </div>
        <div className="vc-face vc-back">
          <span>AniBeam</span>
        </div>
      </div>
    </div>
  )
}
