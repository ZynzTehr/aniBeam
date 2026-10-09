// PROTOTYPE ONLY. Variant A, "Manga Page": the home screen is a manga page.
// Panel size shows trending rank; ink gutters, screentone and speed lines carry the identity.
// Variant D (the chosen direction) reuses these pieces.
import type { CSSProperties, MouseEvent } from 'react'
import { accent, formatOf, seasonOf, titleOf, type Show, type VariantProps } from './data.ts'
import './variant-a.css'

// Desktop placement for the trending page: [column span of 12, row span].
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

const vars = (values: Record<string, string | number>) => values as CSSProperties

/** Called with the title and the element it was opened from (for the opening animation). */
export type OpenTitle = (show: Show, from: HTMLElement) => void

// Without onOpen a panel is a plain link; with it, the click opens the title card instead.
const opener = (show: Show, onOpen?: OpenTitle) =>
  onOpen
    ? (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        onOpen(show, event.currentTarget)
      }
    : undefined

export default function VariantA({ shows, classics }: VariantProps) {
  return (
    <div className="va">
      <MangaHeader variant="A" />
      <main>
        <TrendingPage shows={shows} />
        <ThrowbackStrip classics={classics} />
      </main>
      <footer className="va-foot">Data from AniList · Prototype A</footer>
    </div>
  )
}

export function MangaHeader({ variant }: { variant: string }) {
  return (
    <header className="va-top">
      <a className="va-logo" href={`?variant=${variant}`}>
        <ruby>
          AniBeam<rt>アニビーム</rt>
        </ruby>
      </a>
      <nav className="va-nav" aria-label="Sections">
        <a href={`?variant=${variant}`} aria-current="page">
          Discover
        </a>
        <a href={`?variant=${variant}#pull`}>Pull</a>
        <a href={`?variant=${variant}#list`}>My List</a>
      </nav>
      <label className="va-search">
        <span className="sr-only">Search titles</span>
        <input type="search" placeholder="Search a title…" />
      </label>
    </header>
  )
}

export function TrendingPage({ shows, onOpen }: { shows: Show[]; onOpen?: OpenTitle }) {
  return (
    <section className="va-page" aria-labelledby="va-trending">
      <h1 id="va-trending" className="va-sfx">
        Trending now
        <span aria-hidden="true">ドン!</span>
      </h1>
      <ol className="va-grid">
        {shows.slice(0, LAYOUT.length).map((show, i) => (
          <Panel key={show.id} show={show} rank={i + 1} span={LAYOUT[i]} onOpen={onOpen} />
        ))}
      </ol>
    </section>
  )
}

export function ThrowbackStrip({ classics, onOpen }: { classics: Show[]; onOpen?: OpenTitle }) {
  return (
    <section className="va-strip" aria-labelledby="va-throwback">
      <h2 id="va-throwback" className="va-sfx va-sfx-small">
        Throwback: the &rsquo;90s
        <span aria-hidden="true">バーン</span>
      </h2>
      <ol className="va-strip-row">
        {classics.map((show, i) => (
          <li key={show.id} className="va-strip-item" style={vars({ '--i': i })}>
            <a
              className="va-strip-panel"
              href={`#show-${show.id}`}
              onClick={opener(show, onOpen)}
              style={vars({ '--accent': accent(show.coverImage.color, 'vivid') })}
            >
              <img src={show.coverImage.large} alt="" loading="lazy" />
              <span className="va-chapter" aria-hidden="true">
                Ch.{i + 1}
              </span>
              <span className="va-strip-title">{titleOf(show)}</span>
              <span className="sr-only">, {seasonOf(show)}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Panel({
  show,
  rank,
  span,
  onOpen,
}: {
  show: Show
  rank: number
  span: [number, number]
  onOpen?: OpenTitle
}) {
  const splash = rank === 1
  const meta = [seasonOf(show), formatOf(show), show.episodes && `${show.episodes} eps`]
    .filter(Boolean)
    .join(' · ')
  const cut = rank === 4 ? 'va-cut-right' : rank === 5 ? 'va-cut-left' : ''
  return (
    <li
      className={`va-panel ${splash ? 'va-splash' : ''} ${cut}`}
      style={vars({
        '--c': span[0],
        '--r': span[1],
        '--i': rank,
        '--accent': accent(show.coverImage.color, 'vivid'),
      })}
    >
      <a className="va-link" href={`#show-${show.id}`} onClick={opener(show, onOpen)}>
        <span className="va-img">
          <picture>
            {splash && show.bannerImage && (
              <source media="(min-width: 900px)" srcSet={show.bannerImage} />
            )}
            <img src={show.coverImage.extraLarge} alt="" loading={rank <= 3 ? 'eager' : 'lazy'} />
          </picture>
        </span>
        <span className="va-tone" aria-hidden="true" />
        <span className="va-speed" aria-hidden="true" />
        <span className="va-rank" aria-hidden="true">
          {rank}
        </span>
        {show.averageScore !== null && (
          <span className="va-bubble" aria-hidden="true">
            {show.averageScore}%
          </span>
        )}
        <span className="va-caption">
          <span className="sr-only">Number {rank} trending: </span>
          <b>{titleOf(show)}</b>
          <small>{meta}</small>
          {show.averageScore !== null && (
            <span className="sr-only">, scored {show.averageScore}%</span>
          )}
        </span>
      </a>
    </li>
  )
}
