import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Strip } from '../../components/Strip.tsx'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { statusText, type QueryStatus } from '../../app/status.ts'
import { titleOf } from '../../features/anime/format.ts'
import type { Media } from '../../features/anime/queries.ts'
import { SAMPLES } from '../../features/anime/samples.ts'
import { AniListError } from '../../lib/anilist.ts'
import { LANDING_PARTS, startLanding } from '../../lib/landing.ts'
import { OpenCard } from './CardStage.tsx'
import { useMeasured, useSlots } from './hosts.ts'
import { ListControls } from './ListControls.tsx'
import { titleFor } from './pool.ts'
import {
  entryOf,
  listedIds,
  removeAll,
  restore,
  useList,
  type Entry,
  type List,
} from './sandbox.ts'
import { SiteFrame } from './SiteFrame.tsx'
import type { Lab, Options } from './switches.ts'
import { missingLine, removedFrom, tabName, WORDS } from './wording.ts'

type Tab = 'saved' | 'want'
type View = { tab: Tab; favorites: boolean }
const TABS: { key: Tab; name: string; status: Entry['status'] }[] = [
  { key: 'saved', name: WORDS.saved, status: 'SAVED' },
  { key: 'want', name: WORDS.want, status: 'WANT' },
]
const SORTS = [
  { key: 'changed', name: 'Recently changed' },
  { key: 'title', name: 'Title A–Z' },
  { key: 'season', name: 'Newest season' },
  { key: 'score', name: 'Score' },
] as const
type Sort = (typeof SORTS)[number]['key']

const viewIn = (search: URLSearchParams): View => ({
  tab: search.get('tab') === 'want' ? 'want' : 'saved',
  favorites: search.get('fav') === '1',
})
/** The site's address for a view (D9's links): /list, ?tab=want, &fav=1. */
const siteAddress = ({ tab, favorites }: View) => {
  const search = new URLSearchParams()
  if (tab === 'want') search.set('tab', 'want')
  if (favorites) search.set('fav', '1')
  return `/list${search.size ? `?${search}` : ''}`
}
/** The lab's own address for a view, keeping the lab's choices. */
const labAddress = ({ tab, favorites }: View) => {
  const search = new URLSearchParams(location.search)
  search.delete('tab')
  search.delete('fav')
  if (tab === 'want') search.set('tab', 'want')
  if (favorites) search.set('fav', '1')
  return `?${search}`
}

/** The ids the view shows, taken when it opens (frozen ids): newest change first. */
const idsFor = (list: List, { tab, favorites }: View) => {
  const status = TABS.find(({ key }) => key === tab)!.status
  return listedIds(list).filter((id) => {
    const entry = entryOf(list, id)!
    return entry.status === status && (!favorites || entry.favorite)
  })
}

// What AniList would say, worded as the site words it (see app/status.ts).
const quiet: QueryStatus = {
  data: undefined,
  error: null,
  failureReason: null,
  isFetching: false,
  isPaused: false,
  isPlaceholderData: false,
  dataUpdatedAt: 0,
}
const OUTAGE = statusText({ ...quiet, error: new AniListError('Forbidden', 403) }, false)
const WAITING = statusText({ ...quiet, isPaused: true }, false)
const SAMPLE_IDS = new Set(SAMPLES.map(({ id }) => id))
const LOADING_MS = 1500

/**
 * Section 3: the My List page, inside the site's own header with My List current in yellow (and
 * the phone menu's entry, with its kana). Its covers are the site's own strip in grid mode; the
 * tabs, the filter, the order, the notes and the states are what PR 2 would add. It takes its
 * titles as it opens and keeps them while you look (frozen ids): a removal holds its place, a
 * heart doesn't reorder, and only a change from outside (the lab's list buttons) takes them again.
 */
export function PageStage({ options, lab }: { options: Options; lab: Lab }) {
  return (
    <SiteFrame options={options} onMyList>
      {() => <MyList options={options} lab={lab} />}
    </SiteFrame>
  )
}

function MyList({ options, lab }: { options: Options; lab: Lab }) {
  const list = useList()
  const [view, setView] = useState(() => viewIn(new URLSearchParams(location.search)))
  const [ids, setIds] = useState(() => idsFor(list, view))
  const [sort, setSort] = useState<Sort>('changed')
  const [more, setMore] = useState(0)
  // Removed titles still in their place, with what they were, for Undo (D7).
  const [removed, setRemoved] = useState<Record<number, Entry>>({})
  const [toast, setToast] = useState<{ id: number; entry: Entry; left: number } | null>(null)
  const [card, setCard] = useState<{ media: Media; from: DOMRect } | null>(null)
  const [said, setSaid] = useState('')
  // The list as last drawn, for the handlers below, which run outside a render.
  const lastList = useRef(list)
  useEffect(() => {
    lastList.current = list
  })

  // A new view takes its titles again, and clears any Undo slot (D7).
  const show = (next: View, push: boolean) => {
    setView(next)
    setIds(idsFor(list, next))
    setRemoved({})
    setMore(0)
    if (push) history.pushState(history.state, '', labAddress(next))
  }
  // Back and Forward move between views (D9's links).
  useEffect(() => {
    const moved = () => {
      const next = viewIn(new URLSearchParams(location.search))
      setView(next)
      setRemoved({})
      setIds(idsFor(lastList.current, next))
    }
    addEventListener('popstate', moved)
    return () => removeEventListener('popstate', moved)
  }, [])
  // A change from outside, the lab's list buttons in the shell, takes the titles again.
  useEffect(() => {
    const outside = (event: StorageEvent) => {
      if (event.key !== 'anibeam:lab-list' && event.key !== null) return
      setRemoved({})
      setToast(null)
      setIds(idsFor(lastList.current, viewIn(new URLSearchParams(location.search))))
    }
    addEventListener('storage', outside)
    return () => removeEventListener('storage', outside)
  }, [])
  // The page's own removals: a title on screen that leaves the list gets its Undo (D7). Noted as
  // the page renders, as App's useOutage does, so the slot comes in the same frame.
  const [seen, setSeen] = useState(list)
  if (seen !== list) {
    setSeen(list)
    // Not a title AniList couldn't give: "Remove them" takes those off for good.
    const gone = ids.filter((id) => entryOf(seen, id) && !entryOf(list, id) && titleFor(id))
    const was = Object.fromEntries(gone.map((id) => [id, entryOf(seen, id)!]))
    if (gone.length && options.d7 === 'inline') setRemoved({ ...removed, ...was })
    if (gone.length && options.d7 === 'toast')
      setToast({ id: gone[0], entry: was[gone[0]], left: 5 })
  }
  // The toast's timer (D7's second option): what WCAG's time limits rule fails.
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(
      () => setToast(toast.left > 1 ? { ...toast, left: toast.left - 1 } : null),
      1000,
    )
    return () => clearTimeout(timer)
  }, [toast])
  // Loading: skeletons for a moment, sized to the count, then the titles.
  const [loading, setLoading] = useState(lab.state === 'loading')
  const [loads, setLoads] = useState(0)
  useEffect(() => {
    if (lab.state !== 'loading') return
    const timer = setTimeout(() => setLoading(false), LOADING_MS)
    return () => clearTimeout(timer)
  }, [lab.state, loads])
  const replay = () => {
    setLoading(true)
    setLoads(loads + 1)
  }
  const isLoading = lab.state === 'loading' && loading
  useLayoutEffect(() => startLanding(LANDING_PARTS), [])

  // What the page shows: the view's titles, as AniList's answer (or the samples, or nothing).
  const offline = lab.state === 'offline-empty'
  const outage = lab.state === 'outage'
  const kept = ids.filter((id) => entryOf(list, id) || removed[id])
  const sorted = sortIds(kept, sort)
  const limit = 50 * (1 + more)
  const page = sorted.slice(0, options.d10 === 'more' ? limit : 50)
  const answered = offline
    ? []
    : page
        .filter((id) => !outage || SAMPLE_IDS.has(id))
        .map(titleFor)
        .filter((media): media is Media => media !== null)
  const unknown = offline || outage ? page.filter((id) => !answered.some((m) => m.id === id)) : []
  // Only once AniList has answered: a failed or pending answer never counts as missing.
  const missing = offline || outage || isLoading ? [] : page.filter((id) => titleFor(id) === null)
  const counts = Object.fromEntries(
    TABS.map(({ key }) => [key, idsFor(list, { tab: key, favorites: false }).length]),
  ) as Record<Tab, number>
  const tabNameNow = TABS.find(({ key }) => key === view.tab)!.name

  const [main, setMain] = useState<HTMLElement | null>(null)
  const open: OpenTitle = (media, from) => setCard({ media, from: from.getBoundingClientRect() })
  const closeCard = (id: number) => {
    setCard(null)
    // Back from the card to a title just removed: focus goes to its Undo.
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-undo="${id}"]`)?.focus({ preventScroll: true }),
    )
  }
  const items = useSlots(
    main,
    '.ab-strip-row > .ab-strip-item',
    answered.map(({ id }) => id).join(),
    'ab-lab-item',
  )
  const row = useMeasured(
    () => main?.querySelector('.ab-strip-row:not([aria-hidden])') ?? null,
    [main, isLoading, answered.length],
    null,
  )
  const track = options.d6 === 'link' || options.d5 === 'l1'
  const empty = kept.length === 0
  const note = isLoading
    ? null
    : outage
      ? `${OUTAGE} ${WORDS.samplesFill}`
      : offline
        ? WAITING
        : lab.state === 'offline'
          ? WORDS.offline
          : null
  const orderName = options.d8label === 'changed' ? 'Recently changed' : 'Recently added'

  return (
    <>
      <title>My List · AniBeam</title>
      <main id="main" ref={setMain} className="ab-lab-mylist-page">
        <Strip
          id="my-list"
          level="h1"
          heading="My List"
          sfx={WORDS.kana}
          titles={isLoading ? [] : answered}
          note={note}
          onOpen={open}
          grid
        >
          <Tabs
            options={options}
            view={view}
            counts={counts}
            onView={(next) => show(next, options.d9 === 'links')}
          />
          {options.d9 === 'links' && (
            <p className="ab-lab-address">
              Address on the site: <code>{siteAddress(view)}</code>
            </p>
          )}
          <p className="ab-lab-order">
            {options.d8order === 'fixed' ? (
              <>
                Order: <b>{orderName}</b>
                {options.d8label === 'addedAt' && <small> (by a new addedAt field)</small>}
              </>
            ) : (
              <label>
                Sort{' '}
                <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                  {SORTS.map(({ key, name }) => (
                    <option key={key} value={key}>
                      {key === 'changed' ? orderName : name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </p>
          {missing.length > 0 && (
            <p className="ab-lab-line">
              {missingLine(missing.length)}{' '}
              <button type="button" className="ab-btn" onClick={() => removeAll(missing)}>
                {WORDS.removeThem}
              </button>
            </p>
          )}
          {empty && !isLoading && <Empty view={view} onView={(next) => show(next, true)} />}
        </Strip>
        <div className="ab-lab-foot">
          {sorted.length > 50 && options.d10 === 'fifty' && <p>{WORDS.fifty}</p>}
          {sorted.length > limit && options.d10 === 'more' && (
            <p>
              <button type="button" className="ab-btn" onClick={() => setMore(more + 1)}>
                Show more
              </button>{' '}
              <small>Each press costs one more AniList request.</small>
            </p>
          )}
          <p>{WORDS.browserOnly}</p>
          {lab.state === 'loading' && (
            <button type="button" className="ab-lab-see" onClick={replay}>
              Replay the loading
            </button>
          )}
        </div>
      </main>
      {/* Loading: empty cards sized to the count, in the strip's own row. */}
      {isLoading &&
        row &&
        createPortal(
          Array.from({ length: Math.min(page.length, 50) }, (_, i) => (
            <li key={i} className="ab-strip-item" aria-hidden="true">
              <span className="ab-strip-panel ab-skeleton-fill" />
              {i === 0 && <span className="ab-note-tag ab-lab-tag-over">Loading…</span>}
            </li>
          )),
          row,
        )}
      {/* Offline with nothing cached, or AniList out of reach: plain cards for what's missing. */}
      {!isLoading &&
        unknown.length > 0 &&
        row &&
        createPortal(
          unknown.map((id) => (
            <li key={id} className="ab-strip-item">
              <span className="ab-strip-panel ab-lab-unknown">
                {offline ? WORDS.unavailableOffline : WORDS.unavailable}
              </span>
            </li>
          )),
          row,
        )}
      {items.map(({ id, host }) =>
        createPortal(
          <>
            {options.d5 === 'l1' && entryOf(list, id) && (
              <ListControls id={id} options={options} placement="slim" onSaid={setSaid} />
            )}
            {track && entryOf(list, id) && (
              <a
                className="ab-lab-track"
                href={`https://anilist.co/anime/${id}`}
                target="_blank"
                rel="noreferrer"
              >
                Track on AniList
              </a>
            )}
            {removed[id] && !entryOf(list, id) && (
              <UndoSlot
                id={id}
                tab={tabNameNow}
                focusNow={!card}
                onUndo={() => {
                  setSaid(restore(id, removed[id]))
                  setRemoved((slots) => {
                    const left = { ...slots }
                    delete left[id]
                    return left
                  })
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLElement>(`.ab-strip-panel[href="/anime/${id}"]`)
                      ?.focus({ preventScroll: true }),
                  )
                }}
              />
            )}
          </>,
          host,
          id,
        ),
      )}
      {toast && (
        <div className="ab-lab-toast" role="status">
          {WORDS.removed}.{' '}
          <button
            type="button"
            className="ab-btn"
            onClick={() => {
              setSaid(restore(toast.id, toast.entry))
              setToast(null)
            }}
          >
            {WORDS.undo}
          </button>{' '}
          <small>{toast.left} s</small>
        </div>
      )}
      <p role="status" className="sr-only">
        {said}
      </p>
      {card && (
        <OpenCard
          key={card.media.id}
          media={card.media}
          from={card.from}
          options={options}
          onClose={() => closeCard(card.media.id)}
        />
      )}
    </>
  )
}

/** The view's titles in the order the select asks for (D8's alternative); otherwise as taken. */
function sortIds(ids: number[], sort: Sort) {
  if (sort === 'changed') return ids
  return ids.toSorted((a, b) => {
    const [x, y] = [titleFor(a), titleFor(b)]
    if (!x || !y) return 0
    if (sort === 'title') return titleOf(x).localeCompare(titleOf(y))
    if (sort === 'season') return (y.seasonYear ?? 0) - (x.seasonYear ?? 0)
    return (y.averageScore ?? 0) - (x.averageScore ?? 0)
  })
}

/** Saved and Want to try with their counts, and Favorites only: links (D9) or ARIA tabs. */
function Tabs({
  options,
  view,
  counts,
  onView,
}: {
  options: Options
  view: View
  counts: Record<Tab, number>
  onView: (view: View) => void
}) {
  const go = (next: View) => (event: { preventDefault: () => void }) => {
    event.preventDefault()
    onView(next)
  }
  if (options.d9 === 'links')
    return (
      <nav className="ab-lab-tabs" aria-label="My List">
        {TABS.map(({ key, name }) => (
          <a
            key={key}
            data-lab=""
            href={labAddress({ tab: key, favorites: view.favorites })}
            aria-current={view.tab === key ? 'page' : undefined}
            onClick={go({ tab: key, favorites: view.favorites })}
          >
            {tabName(name, counts[key])}
          </a>
        ))}
        <a
          data-lab=""
          className="ab-lab-filter"
          href={labAddress({ ...view, favorites: !view.favorites })}
          aria-current={view.favorites ? 'true' : undefined}
          onClick={go({ ...view, favorites: !view.favorites })}
        >
          {WORDS.favoritesOnly}
        </a>
      </nav>
    )
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const at = TABS.findIndex(({ key }) => key === view.tab)
    const to =
      event.key === 'ArrowRight'
        ? (at + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (at + TABS.length - 1) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : -1
    if (to < 0) return
    event.preventDefault()
    onView({ ...view, tab: TABS[to].key })
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[role=tab][data-tab="${TABS[to].key}"]`)?.focus(),
    )
  }
  return (
    <div className="ab-lab-tabs">
      <div role="tablist" aria-label="My List">
        {TABS.map(({ key, name }) => (
          <button
            key={key}
            type="button"
            role="tab"
            data-tab={key}
            aria-selected={view.tab === key}
            aria-controls="my-list"
            tabIndex={view.tab === key ? 0 : -1}
            onClick={() => onView({ ...view, tab: key })}
            onKeyDown={move}
          >
            {tabName(name, counts[key])}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="ab-lab-filter"
        aria-pressed={view.favorites}
        onClick={() => onView({ ...view, favorites: !view.favorites })}
      >
        {WORDS.favoritesOnly}
      </button>
    </div>
  )
}

/** A view with nothing in it: what to say, and what to do next. */
function Empty({ view, onView }: { view: View; onView: (view: View) => void }) {
  if (view.favorites)
    return (
      <div className="ab-lab-empty">
        <p>{view.tab === 'saved' ? WORDS.emptyFavorites : WORDS.emptyFavoritesWant}</p>
        <button
          type="button"
          className="ab-btn"
          onClick={() => onView({ ...view, favorites: false })}
        >
          {WORDS.showAll}
        </button>
      </div>
    )
  return (
    <div className="ab-lab-empty">
      <p>{view.tab === 'saved' ? WORDS.emptySaved : WORDS.emptyWant}</p>
      <a className="ab-btn ab-btn-ink" href="/#ab-trending">
        {WORDS.browse}
      </a>
    </div>
  )
}

/** D7's inline Undo, in the removed cover's own place, with focus on Undo and no timer. */
function UndoSlot({
  id,
  tab,
  focusNow,
  onUndo,
}: {
  id: number
  tab: string
  /** Take focus as it appears: not while a card is open over the page (it does on closing). */
  focusNow: boolean
  onUndo: () => void
}) {
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (focusNow) button.current?.focus({ preventScroll: true })
    // Only as it appears.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <span className="ab-lab-undo">
      <span>{removedFrom(tab)}</span>
      <button ref={button} type="button" className="ab-btn" data-undo={id} onClick={onUndo}>
        {WORDS.undo}
      </button>
    </span>
  )
}
