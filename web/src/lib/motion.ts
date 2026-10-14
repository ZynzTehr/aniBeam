// Spec §3J: visitors who ask for reduced motion get no sliding, zooming or swinging. They can ask
// on their device, which the browser reports as prefers-reduced-motion, or on the site itself,
// whose setting is data-motion="reduce" on <html>. A media query sees only the device, so a script
// that moves anything asks reducedMotion(), which hears both: motion.test.ts, beside this file,
// holds every other script to that.

// The device's setting, as a media query. Only this file names it (see motion.test.ts).
const DEVICE = '(prefers-reduced-motion: reduce)'

/** Whether to keep still: the site is set to reduce motion, or the device asks for reduced motion. */
export const reducedMotion = () =>
  document.documentElement.dataset.motion === 'reduce' || deviceReducesMotion()

// The footer's Reduce motion switch shows the site's setting, but while the device asks for
// reduced motion, motion stays reduced whatever the site says: the switch then shows on, locked.
// So it asks about the device alone, and follows it as the visitor changes it with the page open.

/** Whether the device asks for reduced motion, whatever the site's setting. */
export const deviceReducesMotion = () => matchMedia(DEVICE).matches

/**
 * Calls `onChange` each time the device's setting changes, until the function it returns is
 * called. Made for React's useSyncExternalStore, with deviceReducesMotion to read the setting.
 */
export function watchDeviceMotion(onChange: () => void) {
  // A listener belongs to the list it was added to, so the same list must take it off again.
  const list = matchMedia(DEVICE)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

// Turning motion back on, with the switch or on the device, lets every rule in the motion gates
// apply again, and their CSS animations start over on everything already on the page: its
// entrances, which the visitor has already seen, would all play again, and after a pull the
// capsule would drop and split again over the title it gave. So each one is finished at once, at
// its last frame, which is how the page looks once they have played. Content that arrives later
// brings animations of its own, and they play as usual.

/**
 * Finishes the CSS animations that motion coming back on started over. Call it once the change
 * is made: asking for the page's animations brings its styles up to date first, so the ones the
 * gates put back are there to finish. Only those on the page's own clock: the splash cover's drift
 * runs on the scroll, and once finished it falls out of step with it. Transitions run on, as the
 * switch's knob slides off, and an endless animation has no end to finish at (finish() throws).
 */
export function finishEntrances() {
  for (const animation of document.getAnimations())
    if (
      animation instanceof CSSAnimation &&
      animation.timeline === document.timeline &&
      animation.effect?.getComputedTiming().endTime !== Infinity
    )
      animation.finish()
}

// The animations that motion coming back on starts over must be finished before the browser draws
// a frame with them, or that frame shows every entrance at its first keyframe, and the next one
// puts the page back. The device's own change event comes too late for that: Chrome restyles the
// page with the gates open, and draws that frame, before it fires the media query's change event.
// A ResizeObserver comes in time, whichever way motion came back on: watching an element whose
// size the gates change, it calls back after the restyle and layout that open them, before the
// frame is drawn.

/**
 * Calls `onBackOn` each time motion comes back on, by the switch or on the device, in the frame it
 * does, before that frame is drawn, until the function it returns is called. `sentinel` is an
 * element the motion gates widen, as they do .ab-motion-sentinel (see components.css).
 */
export function watchMotionBackOn(sentinel: Element, onBackOn: () => void) {
  // The observer calls back as it starts watching too, with nothing changed: on a page that loads
  // with motion allowed, the entrances have only just begun then. And it calls back as the gates
  // close again. So each call asks whether motion was reduced before and isn't now.
  let reduced = reducedMotion()
  const watch = new ResizeObserver(() => {
    const was = reduced
    reduced = reducedMotion()
    if (was && !reduced) onBackOn()
  })
  watch.observe(sentinel)
  return () => watch.disconnect()
}

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
