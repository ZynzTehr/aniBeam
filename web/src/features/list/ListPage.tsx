import { useIsRestoring, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMemo, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { noteFor } from '../../app/status.ts'
import { isPlainClick } from '../../components/plainClick.ts'
import { Strip } from '../../components/Strip.tsx'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { isRateLimited } from '../../lib/anilist.ts'
import { isListPath, isOver, push, watchPath } from '../../lib/route.ts'
import { listQuery, type Media } from '../anime/queries.ts'
import { entryIn, getSnapshot, listedIds, listedIn, subscribe } from './store.ts'
import { countsIn, inView, viewOf, viewPath, type View } from './view.ts'

// The most titles one request gives: AniList's page (spec §3F). With more on the list, the page
// shows the most lately changed, and says so (the plan's D10).
const PAGE = 50

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
 * order, and asks for nothing (spec §3H); a title taken off the list leaves at once. Titles are
 * edited in their card (the plan's D5, L2), whose "Open on AniList" is the spec's "Track on
 * AniList" link (D6).
 */
export function ListPage({ onOpen }: { onOpen: OpenTitle }) {
  // Read first: listedIds reads the saved list again while nothing listens to it, so the snapshot
  // below is the list as saved now.
  const [ids] = useState(() => listedIds().slice(0, PAGE))
  const list = useSyncExternalStore(subscribe, getSnapshot)
  const query = useQuery({ ...listQuery(ids), enabled: ids.length > 0 })
  const view = viewOf(useSyncExternalStore(watchPath, listSearch))
  const path = viewPath(view)
  // The view's titles as it opened, set as the page renders, as App's useOutage does, so a new
  // view's titles come with its address.
  const [taken, setTaken] = useState(() => ({ path, ids: inView(list, ids, view) }))
  if (taken.path !== path) setTaken({ path, ids: inView(list, ids, view) })

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
  const shown = taken.ids.filter((id) => entryIn(list, id))
  const titles = shown.flatMap((id) =>
    query.data ? (answered.get(id) ?? []) : [copies.get(id) ?? null],
  )
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
        note={shown.length ? noteFor(query, isRateLimited()) : null}
        loading={shown.length > 0 && query.isPending}
        onRetry={query.isError && !query.isFetching ? () => void query.refetch() : undefined}
        onOpen={onOpen}
        grid
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
      <div className="ab-list-foot">
        {listedIn(list).length > PAGE && <p>Showing your {PAGE} most recent.</p>}
        <p>Saved in this browser only.</p>
      </div>
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
