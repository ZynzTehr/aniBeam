import { SAMPLES } from '../../features/anime/samples.ts'
import { KEY, parse, type Entry, type List, type Status } from '../../features/list/store.ts'

// The stamps lab's titles and list. Its titles are the bundled samples alone, so it asks AniList's
// API for nothing; its list is the site's own store, which keeps a list of its own at this address
// (KEY, anibeam:lab-stamps:v1, see store.ts), so the visitor's list is never read or written. The
// shell writes it here, and the stage, in its frame, hears each write as a storage event, as a
// second tab would.

/** The trending page's nine titles. */
export const TRENDING = SAMPLES.slice(0, 9)
/** The decade strip's. */
export const DECADE = SAMPLES.slice(9, 21)
/** A search's results. */
export const SEARCH = SAMPLES.slice(21, 29)

/** A state a listed title can be in, as Fill and Change one write them. */
export type State = { status: Status; favorite: boolean }
export const STATES: State[] = [
  { status: 'SAVED', favorite: false },
  { status: 'SAVED', favorite: true },
  { status: 'WANT', favorite: false },
  { status: 'WANT', favorite: true },
]

/**
 * Fill 4 states: every surface shows all four. On trending, the cut panels 4 and 5 and panels 1
 * and 2; the decade strip's Ch.1 to Ch.4; the first four results; and the first two matches, the
 * widest stamp on the first (`matches`, as the stage reports them, since the sliders sort them).
 */
export function fillPlan(matches: number[]): [number, State][] {
  const four = (ids: number[]) => ids.map((id, i): [number, State] => [id, STATES[i]])
  return [
    ...four([TRENDING[3].id, TRENDING[4].id, TRENDING[0].id, TRENDING[1].id]),
    ...four(DECADE.slice(0, 4).map(({ id }) => id)),
    ...four(SEARCH.slice(0, 4).map(({ id }) => id)),
    ...matches.slice(0, 2).map((id, i): [number, State] => [id, STATES[i ? 2 : 1]]),
  ]
}

const saved = (): List => {
  try {
    return parse(localStorage.getItem(KEY))
  } catch {
    return {}
  }
}

// Each write is made now, after anything the stage did, so it wins the stage's merge (see
// store.ts), as a later edit in another tab does.
// A tab hears no storage event for its own writes, so the shell tells its own store too.
function write(change: (list: List, now: number) => List) {
  try {
    const newValue = JSON.stringify(change(saved(), Date.now()))
    localStorage.setItem(KEY, newValue)
    dispatchEvent(new StorageEvent('storage', { key: KEY, newValue }))
  } catch {
    // Storage blocked: the lab can't share its list with the stage then.
  }
}

const entry = ({ status, favorite }: State, now: number): Entry => ({
  status,
  favorite,
  updatedAt: now,
})

/** Writes each title's state, leaving the rest of the list as it is. */
export const setStates = (plan: [number, State][]) =>
  write((list, now) => ({
    ...list,
    ...Object.fromEntries(plan.map(([id, state]) => [id, entry(state, now)])),
  }))

/** Every sample saved. */
export const allSaved = () => setStates(SAMPLES.map(({ id }) => [id, STATES[0]]))

/** Moves `id` on to the next of the four states. */
export function changeOne(id: number) {
  const now = saved()[id]
  const at = now && !now.deleted ? STATES.findIndex((state) => sameState(state, now)) : -1
  setStates([[id, STATES[(at + 1) % STATES.length]]])
}

const sameState = (a: State, b: State) => a.status === b.status && a.favorite === b.favorite

/** The state `id` is in on the lab's list, or null. */
export function stateOf(list: List, id: number): State | null {
  const now = list[id]
  return now && !now.deleted ? { status: now.status, favorite: now.favorite } : null
}

/**
 * Empties the lab's list: a delete marker on each title, made now, as removing the key would leave
 * the stage's own copy as it was (see the store's onEvent).
 */
export const clear = () =>
  write((list, now) =>
    Object.fromEntries(
      Object.entries(list).map(([id, { status }]) => [
        id,
        { status, favorite: false, updatedAt: now, deleted: true } satisfies Entry,
      ]),
    ),
  )
