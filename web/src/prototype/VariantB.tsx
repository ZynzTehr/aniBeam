// PROTOTYPE ONLY. Variant B, "Opening Sequence": the home screen plays like an anime opening.
// One title card at a time, in the title's own color, with a wipe between scenes.
import { Fragment, useEffect, useState, type CSSProperties, type FocusEvent } from 'react'
import {
  accent,
  formatOf,
  nextEpisode,
  seasonOf,
  studioOf,
  titleOf,
  type Show,
  type VariantProps,
} from './data.ts'
import './variant-b.css'

const SCENE_MS = 7000
const vars = (values: Record<string, string | number>) => values as CSSProperties
const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export default function VariantB({ shows, classics }: VariantProps) {
  const featured = shows.slice(0, 6)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())
  const [held, setHeld] = useState(false) // pointer or keyboard focus is inside the stage
  const running = playing && !held

  useEffect(() => {
    if (!running) return
    const timer = setTimeout(() => setIndex((i) => (i + 1) % featured.length), SCENE_MS)
    return () => clearTimeout(timer)
  }, [index, running, featured.length])

  const show = featured[index]
  const go = (step: number) => setIndex((i) => (i + step + featured.length) % featured.length)
  const releaseFocus = (event: FocusEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setHeld(false)
  }
  const airing = shows
    .filter((s) => s.nextAiringEpisode)
    .sort((a, b) => a.nextAiringEpisode!.timeUntilAiring - b.nextAiringEpisode!.timeUntilAiring)

  return (
    <div className="vb">
      <header className="vb-top">
        <a className="vb-logo" href="?variant=B">
          ANIBEAM
        </a>
        <span className="vb-onair">On air</span>
        <nav className="vb-nav" aria-label="Sections">
          <a href="?variant=B" aria-current="page">
            Discover
          </a>
          <a href="?variant=B#mood">Mood</a>
          <a href="?variant=B#list">My List</a>
        </nav>
        <label className="vb-search">
          <span className="sr-only">Search titles</span>
          <input type="search" placeholder="Search" />
        </label>
      </header>

      <section
        className="vb-stage"
        aria-roledescription="carousel"
        aria-label="Trending this week"
        style={vars({ '--accent': accent(show.coverImage.color, 'dark') })}
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={releaseFocus}
      >
        <div className="vb-ambient" aria-hidden="true" />
        <div aria-live={running ? 'off' : 'polite'}>
          <Scene key={show.id} show={show} index={index} total={featured.length} />
        </div>

        <div className="vb-controls">
          <button type="button" onClick={() => go(-1)} aria-label="Previous title">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5 8 12l7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'Pause the sequence' : 'Play the sequence'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {playing ? (
                <path d="M8 5v14M16 5v14" />
              ) : (
                <path d="M7 4.5v15l12-7.5z" className="fill" />
              )}
            </svg>
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next title">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 5 7 7-7 7" />
            </svg>
          </button>
          <ol className="vb-dots">
            {featured.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-label={`Show ${titleOf(s)}`}
                  aria-current={i === index}
                  onClick={() => setIndex(i)}
                >
                  <span
                    key={`${index}-${running}`}
                    className={
                      i === index ? 'vb-bar is-now' : i < index ? 'vb-bar is-done' : 'vb-bar'
                    }
                    style={vars({
                      '--ms': `${SCENE_MS}ms`,
                      animationPlayState: running ? 'running' : 'paused',
                    })}
                  />
                </button>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Reel
        id="vb-lineup"
        title="Tonight's lineup"
        note="Next episodes, soonest first"
        shows={airing.length ? airing : shows}
      />
      <Reel
        id="vb-rewind"
        title="Rewind: the '90s"
        note="The decade's most-watched"
        shows={classics}
      />
      <footer className="vb-foot">Data from AniList · Prototype B</footer>
    </div>
  )
}

function Scene({ show, index, total }: { show: Show; index: number; total: number }) {
  const title = titleOf(show)
  const size = title.length > 44 ? 'vb-xl' : title.length > 22 ? 'vb-l' : ''
  const studio = studioOf(show)
  const next = nextEpisode(show)
  return (
    <article
      className="vb-scene"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}`}
    >
      <div className="vb-wipe" aria-hidden="true" />
      {show.bannerImage && (
        <div
          className="vb-banner"
          aria-hidden="true"
          style={vars({ backgroundImage: `url(${show.bannerImage})` })}
        />
      )}
      <div className="vb-copy">
        <p className="vb-kicker">
          <span className="vb-num">{String(index + 1).padStart(2, '0')}</span>
          Trending this week · {seasonOf(show)}
        </p>
        <h1 className={`vb-title ${size}`}>
          {title.split(' ').map((word, w) => (
            <Fragment key={w}>
              <span style={vars({ '--w': w })}>{word}</span>{' '}
            </Fragment>
          ))}
        </h1>
        <dl className="vb-meta">
          {studio && (
            <div>
              <dt>Studio</dt>
              <dd>{studio}</dd>
            </div>
          )}
          <div>
            <dt>Format</dt>
            <dd>
              {[formatOf(show), show.episodes && `${show.episodes} eps`]
                .filter(Boolean)
                .join(' · ') || 'TBA'}
            </dd>
          </div>
          {show.averageScore !== null && (
            <div>
              <dt>Score</dt>
              <dd>{show.averageScore}%</dd>
            </div>
          )}
          {next && (
            <div>
              <dt>Next</dt>
              <dd>{next}</dd>
            </div>
          )}
        </dl>
        <div className="vb-actions">
          <button type="button" className="vb-primary">
            Save to My List
          </button>
          <a className="vb-secondary" href={`#show-${show.id}`}>
            Details
          </a>
        </div>
      </div>
      <div className="vb-art" aria-hidden="true">
        {show.title.native && (
          <p className="vb-native" lang="ja">
            {show.title.native}
          </p>
        )}
        <img src={show.coverImage.extraLarge} alt="" />
      </div>
    </article>
  )
}

function Reel({
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
  return (
    <section className="vb-row" aria-labelledby={id}>
      <h2 id={id}>
        {title}
        <small>{note}</small>
      </h2>
      <ol className="vb-reel">
        {shows.map((show, i) => (
          <li key={show.id} style={vars({ '--i': i })}>
            <a
              className="vb-frame"
              href={`#show-${show.id}`}
              style={vars({ '--accent': accent(show.coverImage.color, 'dark') })}
            >
              <img src={show.bannerImage ?? show.coverImage.extraLarge} alt="" loading="lazy" />
              <span className="vb-frame-time">{nextEpisode(show) ?? seasonOf(show)}</span>
              <span className="vb-frame-title">{titleOf(show)}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}
