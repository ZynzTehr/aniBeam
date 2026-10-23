import { entryIn, listedIn, type List, type Status } from './store.ts'

// Which of the list's titles My List shows, its view: a tab, Saved or Want to try, and whether only
// those with the heart (spec §3.0). The page's address holds it, as links that change it (the
// plan's D9): /list?tab=want&fav=1, so Back and Forward move between views, and a view can be
// shared.

/** A tab, Saved or Want to try, and whether Favorites only is on. */
export type View = { status: Status; favorites: boolean }

/** The view an address's query asks for (?tab=want, &fav=1): Saved, all of it, unless it says. */
export function viewOf(search: string): View {
  const query = new URLSearchParams(search)
  return {
    status: query.get('tab') === 'want' ? 'WANT' : 'SAVED',
    favorites: query.get('fav') === '1',
  }
}

/** A view's address, which viewOf reads back: /list, /list?tab=want, /list?tab=want&fav=1. */
export function viewPath({ status, favorites }: View) {
  const query = new URLSearchParams()
  if (status === 'WANT') query.set('tab', 'want')
  if (favorites) query.set('fav', '1')
  return query.size ? `/list?${query}` : '/list'
}

/** Of `ids`, in their order, those `list` has in the view: its tab's, and only hearted ones. */
export const inView = (list: List, ids: number[], { status, favorites }: View) =>
  ids.filter((id) => {
    const entry = entryIn(list, id)
    return entry?.status === status && (!favorites || entry.favorite)
  })

/** How many titles on the list each tab holds, as its link says ("Saved 12"). */
export function countsIn(list: List): Record<Status, number> {
  const counts = { SAVED: 0, WANT: 0 }
  for (const id of listedIn(list)) counts[list[id].status]++
  return counts
}

/**
 * Of `ids`, in their order, those AniList's answer (`media`) leaves out: a title it no longer has,
 * or one its adult-content guard drops (see QUERIES.list). Only for an answer that came: a failed
 * one leaves out nothing (the page says why it has no titles instead).
 */
export function missing(ids: number[], media: readonly { id: number }[]) {
  const given = new Set(media.map(({ id }) => id))
  return ids.filter((id) => !given.has(id))
}
