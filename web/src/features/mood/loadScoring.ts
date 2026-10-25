import { sharedLoad } from '../anime/fallback.ts'
import type * as Scoring from './scoring.ts'

// The mood scoring is a file of its own (scoring.ts; the plan's D5), so the page draws without
// waiting for it. It loads once the browser is idle after the first draw, so it is almost always
// there before a slider moves, and the first time the machine needs it, if it isn't yet.

/** The mood scoring's loader: the scoring, once loaded, and what loads it. */
export type ScoringLoader = { current?: typeof Scoring; load: () => Promise<typeof Scoring> }

/**
 * A loader for the scoring that `load` imports, sharing one run among every caller, kept once it
 * succeeds; a failed run, offline or from an old tab after a deploy renamed the file, is dropped,
 * so the next call tries again.
 */
export function scoringLoader(load: () => Promise<typeof Scoring>): ScoringLoader {
  const loader: ScoringLoader = {
    load: sharedLoad(() => load().then((module) => (loader.current = module))),
  }
  return loader
}

/** The mood scoring Discover's machine ranks titles with. */
export const moodScoring = scoringLoader(() => import('./scoring.ts'))

/**
 * Loads the mood scoring when the browser is next idle (`later`), unless it has loaded already. A
 * failure is let go: the machine asks again when it needs the scoring.
 */
export function preloadScoring(
  loader = moodScoring,
  // Safari has no requestIdleCallback.
  later: (run: () => void) => unknown = globalThis.requestIdleCallback ?? setTimeout,
) {
  if (!loader.current) later(() => void loader.load().catch(() => {}))
}
