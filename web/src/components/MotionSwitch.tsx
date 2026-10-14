import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import {
  deviceReducesMotion,
  finishEntrances,
  saveMotionChoice,
  watchDeviceMotion,
  watchMotionBackOn,
} from '../lib/motion.ts'

/**
 * The site's Reduce motion switch, in the footer: a native checkbox with role="switch", in the
 * chip look. On, it sets data-motion="reduce" on <html>, which every motion rule and script obeys
 * (see lib/motion.ts), and saves the choice for later visits; off, it takes both away. While the
 * device asks for reduced motion, motion stays reduced whatever the site says, so the switch shows
 * on and locked, with a line that says why. Motion comes back on without the page's entrances
 * playing again, whether the switch turns off or the device stops asking (see watchMotionBackOn()
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
  // Motion comes back on as the switch turns off, or as the device stops asking while the site's
  // setting is off, and every animation in the motion gates starts over on what is already on the
  // page. Either way, they are finished in the frame they start, before it is drawn: the gates
  // widen the sentinel, an empty span no one sees, and watchMotionBackOn() hears that in time.
  const sentinel = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const element = sentinel.current
    if (!element) return
    return watchMotionBackOn(element, finishEntrances)
  }, [])
  function choose(reduce: boolean) {
    setSite(reduce)
    if (reduce) document.documentElement.dataset.motion = 'reduce'
    else delete document.documentElement.dataset.motion
    saveMotionChoice(reduce)
  }
  return (
    <div className="ab-motion">
      <span ref={sentinel} className="ab-motion-sentinel" aria-hidden="true" />
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
