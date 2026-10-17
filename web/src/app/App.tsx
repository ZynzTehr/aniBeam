import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { coverFan, COVERS } from '../components/coverFan.ts'
import { IntroHero } from '../components/IntroHero.tsx'
import { MangaPage, PANELS } from '../components/MangaPage.tsx'
import { MotionSwitch } from '../components/MotionSwitch.tsx'
import { SiteHeader } from '../components/SiteHeader.tsx'
import { Strip } from '../components/Strip.tsx'
import { TitleCard, type OpenTitle } from '../components/TitleCard.tsx'
import { TitleNotice } from '../components/TitleNotice.tsx'
import { loadSamples, outOfReach, samplesFor } from '../features/anime/fallback.ts'
import {
  ERAS,
  eraQuery,
  FIRST_ERA,
  isRefinement,
  searchQuery,
  titleQuery,
  trendingQuery,
  type Era,
  type Media,
} from '../features/anime/queries.ts'
import { PullMachine } from '../features/mood/PullMachine.tsx'
import { isRateLimited } from '../lib/anilist.ts'
import { LANDING_PARTS, startLanding } from '../lib/landing.ts'
import { refetchFailed } from '../lib/queryClient.ts'
import { isOver, push, replace, titleIdFrom, titlePath, usePathname } from '../lib/route.ts'
import { useSteadyList } from '../lib/steadyList.ts'
import { useDebounced } from '../lib/useDebounced.ts'
import { noteFor, NOT_FOUND, sampleNote, searchStatus, titleNote } from './status.ts'

const note = (query: UseQueryResult<Media[]>) => noteFor(query, isRateLimited())
// A Try again button when a section's last attempt failed (see App's retryFailed).
const retryFor = (query: UseQueryResult<Media[]>, retryFailed: () => void) =>
  query.isError && !query.isFetching ? retryFailed : undefined
// "the 1990s", or "before 1970"
const eraName = (era: Era) => (era.id === 'pre-1970' ? 'before 1970' : `the ${era.label}`)
// No titles yet: one array for every render, as useSteadyList needs.
const EMPTY: Media[] = []

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
  // Parts of the page land once as they scroll into view (see lib/landing.ts). Started before the
  // browser first draws the page, so no part shows, then hides, then lands.
  useLayoutEffect(() => startLanding(LANDING_PARTS), [])

  // A Try again button when a section's last attempt failed. One press retries every failed
  // section on the page (see refetchFailed). The button hides while retries run, which may
  // first wait out anilist()'s one-minute pause; the status line says so meanwhile.
  const queryClient = useQueryClient()
  const retryFailed = () => void refetchFailed(queryClient)

  // The address says which title's card is open (spec §3.0): /anime/:id, over the page at /. A
  // title opened on the page puts its address in the address bar, as a new history entry, so Back
  // closes the card and Forward opens it again. `opened` is the title last opened on the page, as
  // its list had it, and what opened it, for focus to return to (see below).
  const path = usePathname()
  const addressed = titleIdFrom(path)
  const [opened, setOpened] = useState<{ media: Media; element: HTMLElement } | null>(null)
  const open: OpenTitle = (media, from) => {
    setOpened({ media, element: from })
    // Back from the title returns to this address without its #fragment, as a link to a section
    // leaves one: returning to a fragment, the browser jumps to it again, scrolling to it and
    // focusing it, so closing the card would lose the visitor's place and focus.
    if (location.hash) replace(`${location.pathname}${location.search}`)
    push(titlePath(media.id), { over: path })
  }

  // A visit that starts at a title's address opens its card over the page as AniList's answer
  // arrives, or a note in its place if AniList can't give it (see titleNote). Closing either goes
  // Back to the address it was opened over, or, opened at its address, puts / in its place. An
  // address the app doesn't know becomes /, before the browser draws the page.
  useLayoutEffect(() => {
    if (path !== '/' && addressed === null) replace(`/${location.search}${location.hash}`)
  }, [path, addressed])
  // A title opened on the page shows its list's copy, at once and again on Forward, with no
  // request. That copy is never saved as AniList's answer for the title: it may be a sample, shown
  // while AniList can't be reached, or older than an answer saved for it.
  const fromList = opened && opened.media.id === addressed ? opened.media : undefined
  const title = useQuery({
    ...titleQuery(addressed ?? 0),
    enabled: addressed !== null && !fromList,
  })
  const shownMedia = addressed !== null ? (fromList ?? title.data) : undefined
  // Where the card grows from: what opened it, where that is now, or, opened at its address, the
  // middle of the screen. Measured once each time a card opens, as the page renders, as in
  // useOutage, so the card gets it from the start.
  const [growth, setGrowth] = useState<{ id: number; from: DOMRect } | null>(null)
  if (shownMedia && growth?.id !== shownMedia.id)
    setGrowth({
      id: shownMedia.id,
      from:
        fromList && opened?.element.isConnected
          ? opened.element.getBoundingClientRect()
          : new DOMRect(innerWidth / 2, innerHeight / 2, 0, 0),
    })
  const card =
    shownMedia && growth?.id === shownMedia.id ? { media: shownMedia, from: growth.from } : null
  // However the card goes, focus returns to what opened it. The dialog does that itself as it
  // closes (Close, Esc), but Back takes it off the page while it is open, and focus then falls to
  // the start of the page, losing a keyboard user's place. So then, focus goes back to what opened
  // it, or, if that has left the page meanwhile (a new search), to its title's link there. Before
  // the browser draws the page.
  const shown = card?.media.id ?? null
  const lastShown = useRef<number | null>(null)
  const closedItself = useRef(false)
  useLayoutEffect(() => {
    const id = lastShown.current
    lastShown.current = shown
    const itself = closedItself.current
    closedItself.current = false
    if (shown !== null || id === null || itself || opened?.media.id !== id) return
    if (document.activeElement && document.activeElement !== document.body) return
    const { element } = opened
    const back = element.isConnected
      ? element
      : document.querySelector<HTMLElement>(`#main a[href="${titlePath(id)}"]`)
    back?.focus({ preventScroll: true })
  }, [shown, opened])
  const missing = addressed !== null && !fromList ? titleNote(title, isRateLimited()) : null
  const close = () => {
    closedItself.current = true
    if (isOver(history.state)) history.back()
    else replace('/')
  }

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

  // Title first: while a title opened at its address loads or shows, the page's lists wait, so a
  // shared link costs AniList one request (spec §2), and they ask for theirs as it closes. Lists
  // saved from an earlier visit still show meanwhile.
  const listsWait = addressed !== null
  const trending = useQuery({ ...trendingQuery(), enabled: !listsWait })
  // While a new decade loads, the previous decade's titles stay on screen instead of
  // flashing to empty cards.
  const decade = useQuery({
    ...eraQuery(era),
    placeholderData: keepPreviousData,
    enabled: !listsWait,
  })

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

  // A refresh that reorders trending's panels, or the intro's covers, waits while they are on
  // screen, and shows once they have left it (spec §3H, see useSteadyList). Only AniList's titles
  // wait: the samples give way to them at once. Each hold compares the titles its component shows,
  // so it counts them as the component does: a count of App's own could miss a change in view.
  const [trendingTitles, trendingRef] = useSteadyList(trending.data ?? EMPTY, PANELS)
  // The intro's cover fan, picked as IntroHero picks it. useMemo keeps it one array until
  // trending changes, as useSteadyList needs. The covers are only decoration, so a refresh with
  // no titles, which empties the panels, leaves them: on a phone the fan sits above the headline,
  // and its place would close up.
  const covers = useMemo(() => coverFan(trending.data ?? EMPTY), [trending.data])
  const [introCovers, introRef] = useSteadyList(covers, COVERS, { keepWhenEmpty: true })

  const trendingShown = trending.data ? trendingTitles : trendingSamples
  const decadeShown = decade.data ?? decadeSamples
  // Which list the strip shows, so it opens each new one at Ch.1 (see Strip's list): a decade's
  // titles, or its samples, which are another list. A newly picked decade's list takes over once
  // its titles or samples arrive, not while the last one's stand in for them. A refresh of the
  // decade on screen is the same list, even one that reorders the titles. Set as the page renders,
  // as in useOutage, so the strip gets the new list and its titles together.
  const pickedList = decadeSamples.length ? `${era.id} samples` : era.id
  const [decadeList, setDecadeList] = useState(pickedList)
  if (!decade.isPlaceholderData && decadeList !== pickedList) setDecadeList(pickedList)

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
      {/* The Reduce motion switch sits in the footer, past every title on the page, some 40 Tab
          stops in. This link, in the same place as the one above, takes keyboard users to it. */}
      <a className="ab-skip" href="#reduce-motion">
        Skip to Reduce motion
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
            titles={trending.data ? introCovers : trendingSamples}
            coversRef={introRef}
            // Not once a try has failed or the browser is offline: covers that aren't coming
            // would leave an empty band pushing the buttons off a phone's first screen. The
            // samples' covers are coming, though, until their file fails to load.
            loading={
              trending.isPending &&
              !trending.isPaused &&
              (!trending.failureReason || (trendingOutage && samples === undefined))
            }
            actions={[
              {
                href: '#ab-trending',
                // While the section shows the samples, its heading reads "Fan favorites", so the
                // button that leads there says so too. The header's Trending link stays: it names
                // the section's place in the page.
                label: trendingSamples.length ? 'See fan favorites' : 'See what’s trending',
                primary: true,
              },
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
          titlesRef={trendingRef}
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
          list={decadeList}
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
        <MotionSwitch id="reduce-motion" />
        <p>Data from AniList. AniBeam is not affiliated with AniList.</p>
      </footer>
      {card && (
        <TitleCard key={card.media.id} media={card.media} from={card.from} onClose={close} />
      )}
      {missing && (
        <TitleNotice
          text={missing}
          // Not for a title that isn't there: asking again finds it no more.
          onRetry={
            missing !== NOT_FOUND && title.isError && !title.isFetching
              ? () => void title.refetch()
              : undefined
          }
          onClose={close}
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
  // results. Refining a search keeps the visitor's place while some of its titles are in view;
  // typed from below them, the refined titles would change out of sight, so it starts from the
  // top too, even with the results' empty end in view. The same check runs when the refined
  // search's answer takes the place of the titles that stood in for it (isPlaceholderData turns
  // false): fewer titles fill fewer rows, which can end above the view (the results fill at least
  // a screen, so their empty end is all that shows). Only then: a new search's first answer can
  // come late (after anilist()'s pause, a slow connection or a retry), and must leave the page
  // where the visitor has gone since the search took it to the top. Before paint, so no frame
  // shows the old place.
  const lastTerm = useRef(term)
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // In view: a title ends below the header, or below the top of the screen once a phone's
    // header has scrolled away. Each title's list item is measured, not its panel, which pops in
    // from a smaller size.
    const header = document.querySelector('.ab-top')?.getBoundingClientRect().bottom ?? 0
    const titles = box.current?.querySelectorAll('.ab-strip-row:not([aria-hidden]) > li') ?? []
    const inView = Array.from(titles).some(
      (title) => title.getBoundingClientRect().bottom > Math.max(0, header),
    )
    if (!inView || !isRefinement(lastTerm.current, term)) window.scrollTo({ top: 0 })
    lastTerm.current = term
  }, [term, results.isPlaceholderData])
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
