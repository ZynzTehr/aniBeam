// Spec §3J: visitors who ask for reduced motion get no sliding, zooming or swinging. They can ask
// on their device, which the browser reports as prefers-reduced-motion, or on the site itself,
// whose setting is data-motion="reduce" on <html>. A media query sees only the device, so a script
// that moves anything asks reducedMotion(), which hears both: motion.test.ts, beside this file,
// holds every other script to that.

/** Whether to keep still: the site is set to reduce motion, or the device asks for reduced motion. */
export const reducedMotion = () =>
  document.documentElement.dataset.motion === 'reduce' ||
  matchMedia('(prefers-reduced-motion: reduce)').matches

// The site's setting is saved in localStorage while it is on, so a later visit starts with it. A
// browser can block a site's storage altogether ("block all site data"): reading it then throws.
// Or the saved titles can fill it, and a new value is refused. The page goes on either way, and the
// choice lasts for the visit only.
const SAVED = 'anibeam:motion'

/** Whether the visitor chose to reduce motion on the site, on an earlier visit or this one. */
export function savedMotionChoice() {
  try {
    return localStorage.getItem(SAVED) === 'reduce'
  } catch {
    return false
  }
}

/** Saves the visitor's choice for later visits: kept while motion is reduced, removed once not. */
export function saveMotionChoice(reduce: boolean) {
  try {
    if (reduce) localStorage.setItem(SAVED, 'reduce')
    else localStorage.removeItem(SAVED)
  } catch {
    // Blocked or full: the choice lasts for this visit only.
  }
}
