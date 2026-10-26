import { useSyncExternalStore } from 'react'
import type { Media } from '../anime/queries.ts'
import type { Sliders } from './score.ts'

// What Discover's machine keeps for the visit (the plan's B3 a): the machine is drawn only while My
// List is not open, so state of its own would start over on each way back from /list. Kept here,
// in the page's memory, it stays while the visitor moves around the site, and goes on a reload.

/** The machine's state for the visit. */
export type Session = {
  /** Where each slider stands; 0, no preference. */
  sliders: Sliders
  /** The last rolls' ids, the oldest first, which a roll skips while it can (see rollNext). */
  ring: readonly number[]
  /** How many pulls this visit. */
  pulls: number
  /** The title the last pull gave. */
  pulled: Media | null
  /**
   * The decades whose mood pool is wanted, by id: once a decade's is, it stays so for the visit
   * (see PullMachine).
   */
  wanted: readonly string[]
}

/** No slider set, nothing pulled: how a visit starts. */
export const FRESH: Session = {
  sliders: { energy: 0, tone: 0, complexity: 0 },
  ring: [],
  pulls: 0,
  pulled: null,
  wanted: [],
}

let session = FRESH
const listeners = new Set<() => void>()

/** The machine's state now: one object until it changes, as useSyncExternalStore needs. */
export const getSession = () => session

/** Changes the parts of the state in `change`, and tells each machine on the page. */
export function setSession(change: Partial<Session>) {
  session = { ...session, ...change }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** The machine's state for the visit, drawn again as it changes. */
export const useSession = () => useSyncExternalStore(subscribe, getSession)
