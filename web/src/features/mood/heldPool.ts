import { useCallback, useState } from 'react'
import type { Media } from '../anime/queries.ts'

/** A decade's mood pool as the machine ranks it: the decade's id, and its titles, if any yet. */
export type Held = { era: string | null; titles: readonly Media[] | undefined }

// What of a pool its matches depend on: each title, in order, with its score (its rarity) and the
// genres and tags' ranks the scoring reads.
const whole = (titles: readonly Media[]) =>
  JSON.stringify(
    titles.map(({ id, averageScore, genres, tags }) => [
      id,
      averageScore,
      genres,
      tags.map(({ name, rank }) => [name, rank]),
    ]),
  )

/**
 * Which version of the machine's pool to rank: `shown`, the one it ranks now, or `latest`, what
 * the cache holds now. Spec §3H: a background refresh never re-sorts what is on screen. The
 * matches depend on the whole pool, as a set slider can bring any title of it to the top, so the
 * whole pool is compared, not its first few: while the matches are on screen, a refresh that
 * changes any title's place, score, genres or tags' ranks waits, and shows once they have left it.
 * A pool of another decade always shows at once, on screen or not, as does the first pool, or none.
 */
export function heldPool(shown: Held, latest: Held, onScreen: boolean): Held {
  if (shown.era === latest.era && shown.titles === latest.titles) return shown
  if (!onScreen || shown.era !== latest.era || !shown.titles || !latest.titles) return latest
  return whole(shown.titles) === whole(latest.titles) ? latest : shown
}

/**
 * The decade `era`'s pool `titles`, held by heldPool while the element given the returned ref is
 * on screen: give it to the matches' row, what a new pool's order changes. The sliders are never
 * held: they rank the held pool at once.
 */
export function useHeldPool(era: string | null, titles: readonly Media[] | undefined) {
  const [onScreen, setOnScreen] = useState(false)
  const [shown, setShown] = useState<Held>({ era, titles })
  const held = heldPool(shown, { era, titles }, onScreen)
  // React lets a component update its own state as it renders: it renders again at once.
  if (held !== shown) setShown(held)
  const ref = useCallback((element: Element | null) => {
    if (!element) return
    const observer = new IntersectionObserver((entries) =>
      setOnScreen(entries[entries.length - 1].isIntersecting),
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      setOnScreen(false)
    }
  }, [])
  return [held.titles, ref] as const
}
