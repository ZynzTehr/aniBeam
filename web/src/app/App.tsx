import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { IntroHero } from '../components/IntroHero.tsx'
import { MangaPage } from '../components/MangaPage.tsx'
import { SiteHeader } from '../components/SiteHeader.tsx'
import { Strip } from '../components/Strip.tsx'
import { TitleCard, type OpenTitle } from '../components/TitleCard.tsx'
import {
  ERAS,
  eraQuery,
  searchQuery,
  trendingQuery,
  type Media,
} from '../features/anime/queries.ts'
import { PullMachine } from '../features/mood/PullMachine.tsx'
import { isRateLimited } from '../lib/anilist.ts'
import { useDebounced } from '../lib/useDebounced.ts'
import { noteFor } from './status.ts'

const note = (query: UseQueryResult<Media[]>) => noteFor(query, isRateLimited())

/** AniBeam's page: the intro, this week's trending titles, the pull, and titles by decade. */
export default function App() {
  const [opened, setOpened] = useState<{ media: Media; from: DOMRect } | null>(null)
  const open: OpenTitle = (media, from) => setOpened({ media, from: from.getBoundingClientRect() })

  const [search, setSearch] = useState('')
  const term = useDebounced(search.trim(), 300)
  const searching = term.length >= 2

  // Arrowing through the decade chips changes the choice once per chip; wait like search does.
  const [eraId, setEraId] = useState('1990s')
  const shownEraId = useDebounced(eraId, 300)
  const era = ERAS.find((e) => e.id === shownEraId) ?? ERAS[0]

  const trending = useQuery(trendingQuery())
  // While a new decade or search loads, the previous titles stay on screen instead of
  // flashing to empty cards.
  const decade = useQuery({ ...eraQuery(era), placeholderData: keepPreviousData })
  const results = useQuery({
    ...searchQuery(term),
    enabled: searching,
    placeholderData: keepPreviousData,
  })

  // Pulls draw from titles already on the page, so a pull costs no request.
  const pool = useMemo(() => {
    const all = [...(trending.data ?? []), ...(decade.data ?? [])]
    return all.filter((media, i) => all.findIndex((other) => other.id === media.id) === i)
  }, [trending.data, decade.data])

  // Search results take the intro's place at the top of the page; bring them into view.
  useEffect(() => {
    if (searching) window.scrollTo({ top: 0 })
  }, [searching])

  return (
    <div className="ab-app">
      <a className="ab-skip" href="#main">
        Skip to content
      </a>
      <SiteHeader
        links={[
          { href: '#ab-trending', label: 'Trending' },
          { href: '#pull', label: 'Pull' },
          { href: '#decades', label: 'Decades' },
          { href: '#my-list', label: 'My List', soon: true },
        ]}
        search={search}
        onSearch={setSearch}
      />
      <main id="main">
        {searching ? (
          <div className="ab-results">
            <Strip
              id="results"
              heading={`Results for “${term}”`}
              sfx="サーチ!"
              titles={results.data ?? []}
              note={note(results)}
              loading={results.isPending}
              onOpen={open}
              grid
            />
          </div>
        ) : (
          <IntroHero
            titles={trending.data ?? []}
            actions={[
              { href: '#ab-trending', label: 'See what’s trending', primary: true },
              { href: '#pull', label: 'Pull a random title' },
              { href: '#decades', label: 'Browse by decade' },
            ]}
          />
        )}
        <MangaPage
          id="ab-trending"
          heading="Trending now"
          sfx="ドン!"
          titles={trending.data ?? []}
          note={note(trending)}
          onOpen={open}
        />
        <PullMachine pool={pool} onOpen={open} />
        <Strip
          id="decades"
          heading="Browse by decade"
          sfx="バーン"
          titles={decade.data ?? []}
          note={note(decade)}
          loading={decade.isPending}
          onOpen={open}
        >
          <fieldset className="ab-eras">
            <legend className="sr-only">Decade</legend>
            {ERAS.map((e) => (
              <label key={e.id} className="ab-chip">
                <input
                  type="radio"
                  name="era"
                  value={e.id}
                  checked={eraId === e.id}
                  onChange={() => setEraId(e.id)}
                />
                <span>{e.label}</span>
              </label>
            ))}
          </fieldset>
        </Strip>
      </main>
      <footer className="ab-foot">
        Data from AniList. AniBeam is not affiliated with AniList.
      </footer>
      {opened && (
        <TitleCard
          key={opened.media.id}
          media={opened.media}
          from={opened.from}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  )
}
