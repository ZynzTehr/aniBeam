import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import {
  deviceReducesMotion,
  finishEntrances,
  reducedMotion,
  saveMotionChoice,
  watchDeviceMotion,
} from '../lib/motion.ts'

/**
 * The site's Reduce motion switch, in the footer: a native checkbox with role="switch", in the
 * chip look. On, it sets data-motion="reduce" on <html>, which every motion rule and script obeys
 * (see lib/motion.ts), and saves the choice for later visits; off, it takes both away. While the
 * device asks for reduced motion, motion stays reduced whatever the site says, so the switch shows
 * on and locked, with a line that says why. Motion comes back on without the page's entrances
 * playing again, whether the switch turns off or the device stops asking (see finishEntrances()
 * in lib/motion.ts). `id` goes on the checkbox itself, so a link to it (App's second skip link)
 * focuses the switch as well as bringing it into view: a link's target takes focus when it can,
 * and of the switch's parts only the checkbox can.
 */
export function MotionSwitch({ id }: { id: string }) {
  const why = useId()
  const device = useSyncExternalStore(watchDeviceMotion, deviceReducesMotion)
  // main.tsx has already put a saved choice back on <html>, before React's first render. An
  // effect that wrote this state to <html> as the page loads would take it off again.
  const [site, setSite] = useState(() => document.documentElement.dataset.motion === 'reduce')
  // The device can stop asking for reduced motion with the page open: unless the site's setting
  // still holds motion back, it is then back on, as when the switch turns off. Chrome tells the
  // page only after drawing one frame with motion back on, so that frame shows the entrances
  // starting over.
  useEffect(
    () =>
      watchDeviceMotion(() => {
        if (!reducedMotion()) finishEntrances()
      }),
    [],
  )
  function choose(reduce: boolean) {
    setSite(reduce)
    if (reduce) document.documentElement.dataset.motion = 'reduce'
    else delete document.documentElement.dataset.motion
    saveMotionChoice(reduce)
    // Off, motion is back on, and every animation in the motion gates starts over on what is
    // already on the page. Now that the setting is gone, they are back, so they can be finished.
    if (!reduce) finishEntrances()
  }
  return (
    <div className="ab-motion">
      <label className="ab-chip ab-switch">
        {/* Locked, it stays focusable, so a screen reader reaches it and hears the line that says
            why: aria-disabled, not disabled. So the click is cancelled (Space clicks too), and
            React's change event, which that click still sends, changes nothing. */}
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={device || site}
          aria-disabled={device || undefined}
          aria-describedby={device ? why : undefined}
          onClick={(event) => {
            if (device) event.preventDefault()
          }}
          onChange={(event) => {
            if (!device) choose(event.target.checked)
          }}
        />
        <span>Reduce motion</span>
      </label>
      {device && (
        <p id={why} className="ab-motion-why">
          On because your device is set to reduce motion.
        </p>
      )}
    </div>
  )
}
