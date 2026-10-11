import { hasSmallCover } from '../features/anime/format.ts'
import type { Media } from '../features/anime/queries.ts'

// The intro's cover fan, picked here for both IntroHero, which shows it, and App, which holds a
// new pick while the fan is on screen (see useSteadyList), so the covers held are the covers
// shown. A file of its own: Vite's fast refresh can't hot-swap a component file that also exports
// a function (oxlint's react/only-export-components).

/** How many covers the fan shows. */
export const COVERS = 3

/**
 * The first COVERS titles with a big cover. Three real covers say "anime" at a glance, and small
 * covers are skipped so none look blurry.
 */
export const coverFan = (titles: Media[]) =>
  titles.filter((media) => !hasSmallCover(media)).slice(0, COVERS)
