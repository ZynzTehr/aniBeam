import { createContext, type ComponentType } from 'react'
import type { Status } from '../features/list/store.ts'

// Draft only, never merged: what a stamp slot is (see Stamp.tsx).

/** The surface a cover is on. */
export type Surface = 'trending' | 'strip' | 'search' | 'match' | 'roll' | 'list'

/**
 * Which part of a stamp a slot holds: the visible stamp, the words a screen reader hears, both, or,
 * on a strip cover, the stamp's two possible places (on the title box, with the words; or inside
 * the cover's frame).
 */
export type Part = 'both' | 'look' | 'words' | 'title' | 'cover'

/** What My List's page already says: the tab it shows, and whether Favorites only is on. */
export type StampPage = { tab: Status; favoritesOnly: boolean }

export type StampSlot = { id: number; surface: Surface; part: Part; page?: StampPage }

/** How the lab draws a stamp; null, as on the site, draws none. */
export const StampDraw = createContext<ComponentType<StampSlot> | null>(null)
