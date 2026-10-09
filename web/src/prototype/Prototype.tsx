// PROTOTYPE ONLY. Question: which organizing idea should AniBeam's screens be built on?
// Three anime-pop variants of the home screen, switchable with ?variant=A|B|C, using
// real AniList data. Development only (see main.tsx); never in a production build.
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useState, type KeyboardEvent } from 'react'
import { ninetiesShows, trendingShows } from './data.ts'
import './prototype.css'

const VARIANTS = {
  A: { name: 'Manga Page', Component: lazy(() => import('./VariantA.tsx')) },
  B: { name: 'Opening Sequence', Component: lazy(() => import('./VariantB.tsx')) },
  C: { name: 'Gacha Board', Component: lazy(() => import('./VariantC.tsx')) },
}
type Key = keyof typeof VARIANTS
const KEYS = Object.keys(VARIANTS) as Key[]

// Google Fonts for the comparison only; the chosen faces get self-hosted later.
const FONTS =
  'https://fonts.googleapis.com/css2?family=Anton&family=Dela+Gothic+One&family=M+PLUS+Rounded+1c:wght@400;700;800&family=Mochiy+Pop+One&family=Unbounded:wght@500;700;900&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap'

function variantFromUrl(): Key {
  const value = new URLSearchParams(location.search).get('variant')?.toUpperCase()
  return KEYS.find((key) => key === value) ?? 'A'
}

export default function Prototype() {
  const [key, setKey] = useState(variantFromUrl)
  const trending = useQuery(trendingShows())
  const nineties = useQuery(ninetiesShows())
  const { Component, name } = VARIANTS[key]

  function go(step: number) {
    const next = KEYS[(KEYS.indexOf(key) + step + KEYS.length) % KEYS.length]
    const url = new URL(location.href)
    url.searchParams.set('variant', next)
    history.replaceState(null, '', url)
    setKey(next)
    window.scrollTo(0, 0)
  }

  function onSwitcherKey(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') go(-1)
    if (event.key === 'ArrowRight') go(1)
  }

  const error = trending.error ?? nineties.error
  return (
    <>
      <link rel="stylesheet" href={FONTS} precedence="default" />
      {trending.data && nineties.data ? (
        <Suspense fallback={<p className="proto-status">Loading {name}…</p>}>
          <Component shows={trending.data} classics={nineties.data} />
        </Suspense>
      ) : (
        <p className="proto-status" role="status">
          {error ? `Couldn't load AniList data: ${error.message}` : 'Loading AniList data…'}
        </p>
      )}
      <nav
        className="proto-switcher"
        aria-label="Design prototype switcher"
        onKeyDown={onSwitcherKey}
      >
        <button type="button" onClick={() => go(-1)} aria-label="Previous design">
          ←
        </button>
        <span aria-live="polite">
          {key} · {name}
        </span>
        <button type="button" onClick={() => go(1)} aria-label="Next design">
          →
        </button>
      </nav>
    </>
  )
}
