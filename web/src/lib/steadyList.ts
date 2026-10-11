import { useCallback, useState } from 'react'

type Options = {
  /** Keep what is shown when a refresh brings no titles: for a list that is only decoration. */
  keepWhenEmpty?: boolean
}

/**
 * Which of two versions of a list to show: `shown`, what the page shows now, or `latest`, which a
 * refresh brought. Spec §3H: a visible list is never re-sorted when a background refresh arrives.
 * So while the list is on screen, a new order of its first `count` titles (the ones the page
 * shows) waits, and `shown` stays. Otherwise `latest` shows: off screen, when nothing was shown
 * yet, when it has no titles at all, or when only details changed, such as a score. A list that is
 * only decoration, such as the intro's cover fan, can keep what it shows when `latest` has no
 * titles, on screen or off (`keepWhenEmpty`).
 */
export function steadyList<T extends { id: number }>(
  shown: T[],
  latest: T[],
  onScreen: boolean,
  count: number,
  { keepWhenEmpty = false }: Options = {},
): T[] {
  // An empty list has no order to hold back, and the section's note says "No titles found." as
  // soon as it lands: titles held on screen would show right under it. A decoration has no note
  // to contradict, but a place that would close up, moving what is under it: it keeps its titles.
  if (latest.length === 0 && keepWhenEmpty) return shown
  if (latest.length === 0) return latest
  const order = (list: T[]) =>
    list
      .slice(0, count)
      .map((item) => item.id)
      .join()
  return onScreen && shown.length > 0 && order(shown) !== order(latest) ? shown : latest
}

/**
 * `latest`, held by steadyList while the element given the returned ref is on screen, so a new
 * order shows once that element has left the screen, out of sight. Give the ref to what the
 * order changes, such as the panels, not to their section: at the top of the page the trending
 * section starts right at the bottom of the screen, which an IntersectionObserver counts as on
 * screen. Pass a `latest` that keeps its identity until it changes, as TanStack's data does
 * (build others with useMemo): a new array every render would be stored every render, a loop
 * React stops with an error. `options` go to steadyList.
 */
export function useSteadyList<T extends { id: number }>(
  latest: T[],
  count: number,
  options?: Options,
) {
  const [onScreen, setOnScreen] = useState(false)
  const [shown, setShown] = useState(latest)
  const steady = steadyList(shown, latest, onScreen, count, options)
  // React lets a component update its own state as it renders: it renders again at once.
  if (steady !== shown) setShown(steady)
  // A ref function: React calls it with the element, and what it returns once the element goes
  // (as the intro does during a search). Then nothing of the list is on screen.
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
  return [steady, ref] as const
}
