import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IntroHero } from '../components/IntroHero.tsx'
import { MangaPage } from '../components/MangaPage.tsx'
import { SiteHeader } from '../components/SiteHeader.tsx'
import { Strip } from '../components/Strip.tsx'
import { TitleCard, type OpenTitle } from '../components/TitleCard.tsx'
import { loadSamples, outOfReach, samplesFor } from '../features/anime/fallback.ts'
import {
  ERAS,
  eraQuery,
  FIRST_ERA,
  isRefinement,
  searchQuery,
  trendingQuery,
  type Era,
  type Media,
} from '../features/anime/queries.ts'
import { PullMachine } from '../features/mood/PullMachine.tsx'
import { isRateLimited } from '../lib/anilist.ts'
import { refetchFailed } from '../lib/queryClient.ts'
import { useDebounced } from '../lib/useDebounced.ts'
import { noteFor, sampleNote, searchStatus } from './status.ts'

const note = (query: UseQueryResult<Media[]>) => noteFor(query, isRateLimited())
// A Try again button when a section's last attempt failed (see App's retryFailed).
const retryFor = (query: UseQueryResult<Media[]>, retryFailed: () => void) =>
  query.isError && !query.isFetching ? retryFailed : undefined
// "the 1990s", or "before 1970"
const eraName = (era: Era) => (era.id === 'pre-1970' ? 'before 1970' : `the ${era.label}`)

/**
 * Whether a section shows the sample titles (spec §3H, see fallback.ts) in place of its own: from
 * the moment it has no titles and a try can't reach AniList (outOfReach) until it gets titles.
 * Placeholder titles, such as the last decade's while a new one loads, count as titles. It holds
 * through the tries that follow, because TanStack clears a list's failure when it tries again:
 * Try again would otherwise take the samples away while anilist() waits out its pause, for up to
 * a minute.
 */
function useOutage(query: UseQueryResult<Media[]>) {
  const [latched, setLatched] = useState(false)
  const outage =
    query.data === undefined && (latched || outOfReach(query.failureReason ?? query.error))
  // React lets a component update its own state as it renders: it renders again at once.
  if (outage !== latched) setLatched(outage)
  return outage
}

/** AniBeam's page: the intro, this week's trending titles, the pull, and titles by decade. */
export default function App() {
  // A Try again button when a section's last attempt failed. One press retries every failed
  // section on the page (see refetchFailed). The button hides while retries run, which may
  // first wait out anilist()'s one-minute pause; the status line says so meanwhile.
  const queryClient = useQueryClient()
  const retryFailed = () => void refetchFailed(queryClient)

  const [opened, setOpened] = useState<{ media: Media; from: DOMRect } | null>(null)
  const open: OpenTitle = (media, from) => setOpened({ media, from: from.getBoundingClientRect() })

  // What the search box shows, and the part of it to search (see SiteHeader's onSearch).
  const [search, setSearch] = useState({ shown: '', text: '' })
  // Screen readers hear search outcomes from one line that is always on the page.
  const [announcement, setAnnouncement] = useState('')
  // Debounce every change to the box, then trim what is searched: a typed space, or a letter an
  // input method is still converting, is typing too, so it restarts the pause.
  const term = useDebounced(search, 300).text.trim()
  const searching = term.length >= 2

  // The page opens on FIRST_ERA, which a first visit asks AniList for in one request with
  // trending. Arrowing through the decade chips changes the choice once per chip; wait like
  // search does.
  const [eraId, setEraId] = useState(FIRST_ERA.id)
  const shownEraId = useDebounced(eraId, 300)
  const era = ERAS.find((e) => e.id === shownEraId) ?? ERAS[0]

  const trending = useQuery(trendingQuery())
  // While a new decade loads, the previous decade's titles stay on screen instead of
  // flashing to empty cards.
  const decade = useQuery({ ...eraQuery(era), placeholderData: keepPreviousData })

  // A section that can't reach AniList shows sample titles instead, labelled (see useOutage):
  // trending the first 9, the strip the open decade's. They load the first time a section needs
  // them, or are null if their file fails to load. They are swapped in here, as the page renders,
  // never put in the query cache, which is saved for a day: they would come back on the next
  // visit as AniList's answer, and pass for fresh.
  const trendingOutage = useOutage(trending)
  const decadeOutage = useOutage(decade)
  const wantSamples = trendingOutage || decadeOutage
  const [samples, setSamples] = useState<Media[] | null>()
  useEffect(() => {
    if (wantSamples) void loadSamples().then(setSamples, () => setSamples(null))
  }, [wantSamples])
  const trendingSamples = useMemo(
    () => (trendingOutage && samples ? samples.slice(0, 9) : []),
    [trendingOutage, samples],
  )
  const decadeSamples = useMemo(
    () => (decadeOutage && samples ? samplesFor(samples, era) : []),
    [decadeOutage, samples, era],
  )
  const trendingShown = trending.data ?? trendingSamples
  const decadeShown = decade.data ?? decadeSamples

  // Pulls draw from titles already on the page, so a pull costs no request.
  const pool = useMemo(() => {
    const all = [...trendingShown, ...decadeShown]
    return all.filter((media, i) => all.findIndex((other) => other.id === media.id) === i)
  }, [trendingShown, decadeShown])

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
        search={search.shown}
        onSearch={(shown, text) => setSearch({ shown, text })}
      />
      <main id="main">
        <p role="status" className="sr-only">
          {announcement}
        </p>
        {searching ? (
          <SearchResults
            term={term}
            onOpen={open}
            retryFailed={retryFailed}
            onStatus={setAnnouncement}
          />
        ) : (
          <IntroHero
            titles={trendingShown}
            // Not once a try has failed or the browser is offline: covers that aren't coming
            // would leave an empty band pushing the buttons off a phone's first screen. The
            // samples' covers are coming, though, until their file fails to load.
            loading={
              trending.isPending &&
              !trending.isPaused &&
              (!trending.failureReason || (trendingOutage && samples === undefined))
            }
            actions={[
              { href: '#ab-trending', label: 'See what’s trending', primary: true },
              { href: '#pull', label: 'Pull a random title' },
              { href: '#decades', label: 'Browse by decade' },
            ]}
          />
        )}
        <MangaPage
          id="ab-trending"
          heading={trendingSamples.length ? 'Fan favorites' : 'Trending now'}
          sfx="ドン!"
          titles={trendingShown}
          // The samples have no rank: they are well-loved titles, not this week's trending.
          ranked={!trendingSamples.length}
          note={
            trendingSamples.length
              ? sampleNote(
                  'These are fan favorites, not this week’s trending.',
                  trending,
                  isRateLimited(),
                )
              : note(trending)
          }
          loading={trending.isPending}
          onRetry={retryFor(trending, retryFailed)}
          onOpen={open}
        />
        <PullMachine pool={pool} onOpen={open} />
        <Strip
          id="decades"
          heading="Browse by decade"
          sfx="バーン"
          titles={decadeShown}
          note={
            decadeSamples.length
              ? sampleNote(
                  `A few fan favorites from ${eraName(era)}, not the full list.`,
                  decade,
                  isRateLimited(),
                )
              : note(decade)
          }
          loading={decade.isPending || decade.isPlaceholderData}
          onRetry={retryFor(decade, retryFailed)}
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

/**
 * Search results, rendered only while searching. While a search loads, the titles on screen
 * stay only if the visitor is refining their search (isRefinement); a different search, even
 * one typed straight over the last, starts from empty cards. Titles that have left the screen
 * don't come back.
 */
function SearchResults({
  term,
  onOpen,
  retryFailed,
  onStatus,
}: {
  term: string
  onOpen: OpenTitle
  retryFailed: () => void
  /** Receives the screen-reader announcement for this search ('' once it is gone). */
  onStatus: (text: string) => void
}) {
  // Whether the last render showed titles: this search's own, or those of the one it refines.
  // TanStack offers the last search that had titles, even after a different search's empty
  // cards have replaced them.
  const titlesShown = useRef(false)
  const results = useQuery({
    ...searchQuery(term),
    placeholderData: (previous, previousQuery) => {
      const before = (previousQuery?.queryKey[2] as { search?: string } | undefined)?.search
      return titlesShown.current && isRefinement(before ?? '', term) ? previous : undefined
    },
  })
  useLayoutEffect(() => {
    titlesShown.current = Boolean(results.data?.length)
  })
  const status = searchStatus(results, term, isRateLimited())
  useEffect(() => onStatus(status), [status, onStatus])
  useEffect(() => () => onStatus(''), [onStatus])

  // A different search starts from the top of the page, where its heading and loading state
  // show. On wide screens the header stays put, so the box can be typed in from far down the
  // results. Refining a search keeps the visitor's place while some of the results are in view;
  // typed from below them, the refined titles would change out of sight, so it starts from the
  // top too. Before paint, so no frame shows the old place.
  const lastTerm = useRef(term)
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // In view: the results end below the header, or below the top of the screen once a phone's
    // header has scrolled away.
    const header = document.querySelector('.ab-top')?.getBoundingClientRect().bottom ?? 0
    const inView = (box.current?.getBoundingClientRect().bottom ?? 0) > Math.max(0, header)
    if (!inView || !isRefinement(lastTerm.current, term)) window.scrollTo({ top: 0 })
    lastTerm.current = term
  }, [term])
  return (
    <div ref={box} className="ab-results">
      <Strip
        id="results"
        // The results take the intro's place, so their heading is the page's h1.
        level="h1"
        heading={`Results for “${term}”`}
        sfx="サーチ!"
        titles={results.data ?? []}
        note={note(results)}
        loading={results.isPending || results.isPlaceholderData}
        onRetry={retryFor(results, retryFailed)}
        onOpen={onOpen}
        live={false}
        grid
      />
    </div>
  )
}
