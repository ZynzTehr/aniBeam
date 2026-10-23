import { useIsRestoring, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { heldUp, noteFor } from '../../app/status.ts'
import { isPlainClick } from '../../components/plainClick.ts'
import { Strip } from '../../components/Strip.tsx'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { isRateLimited } from '../../lib/anilist.ts'
import { isListPath, isOver, push, titlePath, watchPath } from '../../lib/route.ts'
import { loadSamples, useOutage } from '../anime/fallback.ts'
import { listQuery, type Media } from '../anime/queries.ts'
import { nextLine, noted, said as saidAfter } from './said.ts'
import {
  entryIn,
  getSnapshot,
  listedIds,
  listedIn,
  removeAll,
  restore,
  subscribe,
  type Entry,
  type List,
} from './store.ts'
import { countsIn, inView, missing, viewOf, viewPath, type View } from './view.ts'

// The most titles one request gives: AniList's page (spec §3F). With more on the list, the page
// shows the most lately changed, and says so (the plan's D10).
const PAGE = 50

// What a title's place says with no details to show (see Strip), and what the outage line adds
// while the samples show, in the words the visitor approved in the mockup (the plan's D14).
const OFFLINE = 'Details unavailable offline'
const UNAVAILABLE = 'Details unavailable'
const SAMPLES_FILL = 'Sample titles fill in what they can.'

const TABS = [
  { status: 'SAVED', name: 'Saved' },
  { status: 'WANT', name: 'Want to try' },
] as const

// The query of My List's address, which holds its view (see view.ts): the address's own, or, under
// a title's card opened over My List, the one the card's history entry keeps (see App's open),
// after a reload there too.
const listSearch = () =>
  isListPath(location.pathname)
    ? location.search
    : isOver(history.state)
      ? history.state.over.replace(/^[^?]*/, '')
      : ''

/** What a view shows, as it took it when it opened (see ListPage). */
type Taken = {
  /** The view's address. */
  path: string
  /** Its titles, in the list's order. */
  ids: number[]
  /** Those taken off the list since, each with the entry it had, for its Undo (the plan's D7). */
  removed: Record<number, Entry>
  /** The Undo that takes focus once no card is over the page: a new object for each removal. */
  focus: { id: number } | null
}

const take = (list: List, ids: number[], view: View, path: string): Taken => ({
  path,
  ids: inView(list, ids, view),
  removed: {},
  focus: null,
})

/**
 * Copies of `ids`' titles that AniList's other answers in the cache hold, by id: Discover's lists,
 * searches, a title asked for on its own, or My List's answer for an earlier set of ids. Shown in
 * their places while My List's own answer comes, never saved as it.
 */
function copiesIn(client: QueryClient, ids: number[]) {
  const copies = new Map<number, Media>()
  for (const [, data] of client.getQueriesData<Media[] | Media>({ queryKey: ['anilist'] }))
    for (const media of Array.isArray(data) ? data : data ? [data] : [])
      if (ids.includes(media.id)) copies.set(media.id, media)
  return copies
}

/**
 * My List (spec §3F), at /list, in Discover's place, and under a title's card opened over it.
 * Drawn on its own, as App leaves Discover's lists off here, so the page asks AniList for none of
 * them. Its titles are those saved as it opens, the 50 most lately changed of both tabs (AniList's
 * page), asked for in one request, so its tabs and Favorites only, links that change the address
 * (the plan's D9), show theirs from that one answer. Each view takes its titles as it opens, in
 * the list's order, the most lately changed first ("Recently changed", the plan's D8): an edit
 * from a card opened over the page, a heart or a move, changes neither which titles show nor their
 * order, and asks for nothing (spec §3H); a title taken off the list leaves an Undo in its place
 * (D7). Titles are edited in their card (the plan's D5, L2), whose "Open on AniList" is the spec's
 * "Track on AniList" link (D6). A title AniList's answer leaves out keeps its place, with no
 * details, and the page offers to take such titles off; a failed answer leaves out none. With
 * AniList out of reach, the sample titles fill in theirs (spec §3H), and offline, those with no
 * copy saved say so. `covered` says a title's card is open over the page.
 */
export function ListPage({ onOpen, covered }: { onOpen: OpenTitle; covered: boolean }) {
  // Read first: listedIds reads the saved list again while nothing listens to it, so the snapshot
  // below is the list as saved now.
  const [ids] = useState(() => listedIds().slice(0, PAGE))
  const list = useSyncExternalStore(subscribe, getSnapshot)
  const query = useQuery({ ...listQuery(ids), enabled: ids.length > 0 })
  // The titles AniList's answer left out (see missing): only of an answer that came, never of a
  // failed one (a 500, a refusal), which says nothing about which titles AniList has.
  const left = useMemo(() => (query.data ? missing(ids, query.data) : []), [ids, query.data])
  const view = viewOf(useSyncExternalStore(watchPath, listSearch))
  const path = viewPath(view)
  // The view's titles as it opened, set as the page renders, as App's useOutage does, so a new
  // view's titles come with its address.
  const [taken, setTaken] = useState(() => take(list, ids, view, path))
  if (taken.path !== path) setTaken(take(list, ids, view, path))
  // A title on screen taken off the list keeps its place, with an Undo in it, until the view
  // changes or the page is left, with no timer, as WCAG's rule on time limits asks (the plan's
  // D7). Taken off in the card over the page, its Undo takes focus as the card closes (see below).
  // Noted as the page renders, as for the view, so the Undo comes in the frame the cover goes.
  const [seen, setSeen] = useState(list)
  if (seen !== list) {
    setSeen(list)
    // Not a title the answer left out: "Remove them" takes those off for good.
    const gone = taken.ids.filter(
      (id) => entryIn(seen, id) && !entryIn(list, id) && !left.includes(id),
    )
    if (gone.length)
      setTaken({
        ...taken,
        removed: {
          ...taken.removed,
          ...Object.fromEntries(gone.map((id) => [id, entryIn(seen, id)!])),
        },
        focus: covered ? { id: gone[0] } : taken.focus,
      })
  }
  // The card hands focus back to the cover that opened it as it closes (see App), but the cover
  // has gone: its Undo takes it, before App looks. Once for each removal.
  const focused = useRef<Taken['focus']>(null)
  useLayoutEffect(() => {
    if (covered || !taken.focus || focused.current === taken.focus) return
    focused.current = taken.focus
    document
      .querySelector<HTMLElement>(`#main [data-undo="${taken.focus.id}"]`)
      ?.focus({ preventScroll: true })
  }, [covered, taken.focus])
  // What a screen reader hears after Undo: a full list, or an edit storage refused (see said.ts).
  // The cover back in its place, which takes focus, says the rest.
  const [said, setSaid] = useState('')
  const undo = (id: number) => {
    // Drawn at once, so that the cover that takes the Undo's place can take its focus too.
    const outcome = flushSync(() => restore(id, taken.removed[id]))
    document
      .querySelector<HTMLElement>(`#main .ab-strip-panel[href="${titlePath(id)}"]`)
      ?.focus({ preventScroll: true })
    setSaid((before) => nextLine(before, noted(outcome)))
  }

  // While My List's answer comes, the titles other answers brought show in their places at once,
  // and an empty card holds each other one's (see Strip). The cache is read once restored.
  const client = useQueryClient()
  const restoring = useIsRestoring()
  const copies = useMemo(
    () => (restoring ? new Map<number, Media>() : copiesIn(client, ids)),
    [restoring, client, ids],
  )
  const answered = useMemo(
    () => new Map(query.data?.map((media) => [media.id, media])),
    [query.data],
  )
  // AniList out of reach, with no answer saved: the sample titles on the list show in their places
  // (see useOutage), swapped in here, as the page renders, never put in the query cache, as App's
  // are not. They load the first time they are needed, or are null if their file fails to load.
  const outage = useOutage(query)
  const [samples, setSamples] = useState<Media[] | null>()
  useEffect(() => {
    if (outage) void loadSamples().then(setSamples, () => setSamples(null))
  }, [outage])
  const sampled = useMemo(
    () => new Map((outage && samples ? samples : []).map((media) => [media.id, media])),
    [outage, samples],
  )
  // A title with no details to show, and none coming for now: offline, as TanStack holds the
  // request until the connection is back; a failed answer; or AniList out of reach, once the
  // samples have filled in theirs. Else an empty card, as its details are on their way.
  const none = query.isPaused
    ? OFFLINE
    : query.isError || (outage && samples !== undefined)
      ? UNAVAILABLE
      : null
  const shown = taken.ids.filter((id) => entryIn(list, id) || Object.hasOwn(taken.removed, id))
  // Each title's place: AniList's answer, or while it has none, a copy another answer brought, or
  // a sample. A title the answer left out keeps its place, with no details, so nothing moves. One
  // taken off with none shows nothing: there's no cover to put back.
  const titles = shown.flatMap((id): (Media | string | null)[] => {
    const media = query.data ? answered.get(id) : (copies.get(id) ?? sampled.get(id))
    return media ? [media] : entryIn(list, id) ? [query.data ? UNAVAILABLE : none] : []
  })
  // The view's titles the answer left out, which "Remove them" takes off the list, in one edit.
  // Focus, on the button that goes with them, moves to the page's heading, as Try again's does.
  const lost = shown.filter((id) => entryIn(list, id) && left.includes(id))
  const removeLost = (event: MouseEvent<HTMLButtonElement>) => {
    const outcome = removeAll(lost)
    document
      .getElementById('ab-list')
      ?.focus({ preventScroll: !event.currentTarget.matches(':focus-visible') })
    setSaid((before) => nextLine(before, saidAfter(outcome, null)))
  }
  const counts = countsIn(list)
  const empty = !shown.length && !inView(list, listedIn(list), view).length

  // A plain click on a view's link changes the address, as a new history entry, with no new page.
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return
    event.preventDefault()
    const to = event.currentTarget.getAttribute('href')!
    if (to !== `${location.pathname}${location.search}`) push(to, null)
  }
  return (
    <div className="ab-list">
      <title>My List · AniBeam</title>
      <Strip
        id="ab-list"
        level="h1"
        heading="My List"
        sfx="マイリスト"
        titles={titles}
        note={
          !shown.length
            ? null
            : outage && samples
              ? `${heldUp(query, isRateLimited())} ${SAMPLES_FILL}`
              : noteFor(query, isRateLimited())
        }
        loading={titles.includes(null)}
        onRetry={query.isError && !query.isFetching ? () => void query.refetch() : undefined}
        onOpen={onOpen}
        grid
        inPlaceOf={({ id }) =>
          entryIn(list, id) ? undefined : (
            <UndoSlot id={id} was={taken.removed[id]} onUndo={() => undo(id)} />
          )
        }
      >
        <nav className="ab-list-tabs" aria-label="My List">
          {TABS.map(({ status, name }) => (
            <a
              key={status}
              className="ab-btn"
              href={viewPath({ ...view, status })}
              aria-current={view.status === status ? 'page' : undefined}
              onClick={follow}
            >
              {name} {counts[status]}
            </a>
          ))}
          <a
            className="ab-btn"
            href={viewPath({ ...view, favorites: !view.favorites })}
            aria-current={view.favorites || undefined}
            onClick={follow}
          >
            Favorites only
          </a>
        </nav>
        <p className="ab-list-order">
          Order: <b>Recently changed</b>
        </p>
        {empty && <Empty view={view} onFollow={follow} />}
      </Strip>
      <p role="status" className="sr-only">
        {said}
      </p>
      <div className="ab-list-foot">
        {listedIn(list).length > PAGE && <p>Showing your {PAGE} most recent.</p>}
        <p>Saved in this browser only.</p>
        {/* Last, under the rest, so nothing moves as it comes with AniList's answer. */}
        {lost.length > 0 && (
          <p className="ab-list-lost">
            {lost.length} {lost.length === 1 ? 'title' : 'titles'} couldn’t be shown.{' '}
            <button type="button" className="ab-btn" onClick={removeLost}>
              Remove them
            </button>
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The Undo in the place of a title taken off the list (the plan's D7): which tab it left, and Undo,
 * which puts it back as it was (see restore).
 */
function UndoSlot({ id, was, onUndo }: { id: number; was: Entry; onUndo: () => void }) {
  const words = useId()
  const tab = TABS.find(({ status }) => status === was.status)!.name
  return (
    <div className="ab-list-undo">
      <span id={words}>Removed from {tab}.</span>{' '}
      <button
        type="button"
        className="ab-btn"
        data-undo={id}
        aria-describedby={words}
        onClick={onUndo}
      >
        Undo
      </button>
    </div>
  )
}

/** A view with nothing in it: what to say, and where to go next. */
function Empty({
  view,
  onFollow,
}: {
  view: View
  onFollow: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const tab = TABS.find(({ status }) => status === view.status)!.name
  return (
    <div className="ab-list-empty">
      {view.favorites ? (
        <>
          <p>No favorites in {tab} yet.</p>
          <a
            className="ab-btn ab-btn-ink"
            href={viewPath({ ...view, favorites: false })}
            onClick={onFollow}
          >
            Show all
          </a>
        </>
      ) : (
        <>
          <p>{view.status === 'SAVED' ? 'Nothing saved yet.' : 'Nothing to try yet.'}</p>
          <a className="ab-btn ab-btn-ink" href="/#ab-trending">
            Browse what’s trending
          </a>
        </>
      )}
    </div>
  )
}
