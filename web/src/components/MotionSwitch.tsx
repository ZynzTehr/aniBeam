import { useId, useState, useSyncExternalStore } from 'react'
import { deviceReducesMotion, saveMotionChoice, watchDeviceMotion } from '../lib/motion.ts'

/**
 * The site's Reduce motion switch, in the footer: a native checkbox with role="switch", in the
 * chip look. On, it sets data-motion="reduce" on <html>, which every motion rule and script obeys
 * (see lib/motion.ts), and saves the choice for later visits; off, it takes both away. While the
 * device asks for reduced motion, motion stays reduced whatever the site says, so the switch shows
 * on and locked, with a line that says why.
 */
export function MotionSwitch() {
  const why = useId()
  const device = useSyncExternalStore(watchDeviceMotion, deviceReducesMotion)
  // main.tsx has already put a saved choice back on <html>, before React's first render. An
  // effect that wrote this state to <html> as the page loads would take it off again.
  const [site, setSite] = useState(() => document.documentElement.dataset.motion === 'reduce')
  function choose(reduce: boolean) {
    setSite(reduce)
    if (reduce) document.documentElement.dataset.motion = 'reduce'
    else delete document.documentElement.dataset.motion
    saveMotionChoice(reduce)
  }
  return (
    <div className="ab-motion">
      <label className="ab-chip ab-switch">
        {/* Locked, it stays focusable, so a screen reader reaches it and hears the line that says
            why: aria-disabled, not disabled. So the click is cancelled (Space clicks too), and
            React's change event, which that click still sends, changes nothing. */}
        <input
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
