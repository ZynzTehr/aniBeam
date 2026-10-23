import { sharedLoad } from '../anime/fallback.ts'
import type { ListPage } from './ListPage.tsx'
import { getSnapshot, listedIn, subscribe } from './store.ts'

// My List's page is a file of its own (the plan's D18), so a visit that never opens My List never
// downloads it, as the samples aren't (see fallback.ts). It loads the first time the page is
// needed, before React first draws a visit that starts on it (see main.tsx), or in the background
// once the list holds a title (see preloadListPage).

/** My List's page, once its file has loaded (see loadListPage). */
export const loaded: { ListPage?: typeof ListPage } = {}

/**
 * Loads My List's page, sharing one run among every caller, kept once it succeeds; a failed run, as
 * offline, is dropped, so the next call tries again.
 */
export const loadListPage = sharedLoad(() =>
  import('./ListPage.tsx').then((module) => (loaded.ListPage = module.ListPage)),
)

/**
 * Once the visitor's list holds a title, saved in this visit or an earlier one, loads My List's
 * page when the browser is next idle, so that the page opens offline too: a visitor who saves a
 * title and goes offline before ever opening My List would otherwise find it couldn't be drawn. It
 * listens to the list only until then, and not at all once the page has loaded: while something
 * listens, the store doesn't read the saved list again as the page opens (see store.ts's read).
 */
export function preloadListPage() {
  if (loaded.ListPage) return
  let stop = () => {}
  const check = () => {
    if (!listedIn(getSnapshot()).length) return
    stop()
    // Safari has no requestIdleCallback.
    const idle = window.requestIdleCallback ?? setTimeout
    idle(() => void loadListPage().catch(() => {}))
  }
  stop = subscribe(check)
  check()
}
