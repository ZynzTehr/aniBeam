import { useRef, type PointerEvent, type ReactNode } from 'react'
import { cssVars } from '../../components/cssVars.ts'
import type { Media } from '../../features/anime/queries.ts'
import { MoodSlider } from '../../features/mood/MoodSlider.tsx'
import type { Stop } from '../../features/mood/moods.ts'
import { accentVars } from '../../features/theming/deriveAccent.ts'
import { anySet, type Sliders } from './score.ts'
import type { Options } from './switches.ts'
import { PAGE } from './wording.ts'
import { axesFor } from './words.ts'

// A tap that moved less than this, in CSS pixels, over less than this long, is a tap, not a drag.
const TAP_PX = 10
const TAP_MS = 500
// MoodSlider.css's thumb, whose middle travels from half its width in to half its width in.
const THUMB = 40

/**
 * The machine, in the pull machine's own classes: the dome with 9 capsules (`capsules`, colored as
 * A7 says), and the red body with the site's MoodSliders, Reset moods, and whatever `children`
 * brings (the lever and its count, from the gacha). `off` turns the sliders off (offline with
 * nothing cached).
 *
 * A5 (a), tap to set: a tap on a slider's track, not a drag, sets the stop under the finger. Safari
 * on an iPhone only focuses a slider on a tap, which feels broken. The handler sits on the sliders'
 * box, so MoodSlider is unchanged; it sets the value and tells the page, and never focuses the
 * slider from code (WebKit bug 266283). A mouse's click already jumps, so it is left alone.
 */
export function Machine({
  options,
  sliders,
  onSliders,
  capsules,
  off = false,
  children,
}: {
  options: Options
  sliders: Sliders
  onSliders: (next: Sliders) => void
  capsules: Media[]
  off?: boolean
  children?: ReactNode
}) {
  const axes = axesFor(options)
  const tap = useRef<{ x: number; y: number; at: number } | null>(null)
  const isRange = (target: EventTarget) =>
    target instanceof HTMLInputElement && target.type === 'range'
  const down = (event: PointerEvent<HTMLDivElement>) => {
    tap.current =
      options.a5 === 'tap' && event.pointerType !== 'mouse' && isRange(event.target)
        ? { x: event.clientX, y: event.clientY, at: event.timeStamp }
        : null
  }
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const start = tap.current
    tap.current = null
    if (!start || !isRange(event.target)) return
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (moved > TAP_PX || event.timeStamp - start.at > TAP_MS) return
    const input = event.target as HTMLInputElement
    const box = input.getBoundingClientRect()
    const along = (event.clientX - box.left - THUMB / 2) / Math.max(1, box.width - THUMB)
    const stop = Math.max(-2, Math.min(2, Math.round(along * 4) - 2)) as Stop
    const axis = axes[[...event.currentTarget.querySelectorAll('input')].indexOf(input)]
    if (axis && stop !== sliders[axis]) onSliders({ ...sliders, [axis]: stop })
  }
  const showReset = options.a4reset === 'always' || anySet(sliders)
  return (
    <div className="ab-machine">
      <div className="ab-dome" aria-hidden="true">
        {capsules.slice(0, 9).map((media, i) => (
          <span
            key={i}
            className="ab-capsule"
            style={{ ...accentVars(media.coverImage.color), ...cssVars({ '--i': i }) }}
          />
        ))}
      </div>
      <div className="ab-body">
        <fieldset className="ab-lab-sliders" disabled={off}>
          <legend className="sr-only">{PAGE.group}</legend>
          <div className="ab-lab-slider-box" onPointerDown={down} onPointerUp={up}>
            {axes.map((axis) => (
              <MoodSlider
                key={axis}
                axis={axis}
                value={sliders[axis]}
                onChange={(value) => onSliders({ ...sliders, [axis]: value })}
              />
            ))}
          </div>
        </fieldset>
        {/* Its room is kept while it is hidden, so nothing moves as it comes and goes. */}
        <button
          type="button"
          className={showReset ? 'ab-lab-reset' : 'ab-lab-reset is-hidden'}
          onClick={() => onSliders({ energy: 0, tone: 0, complexity: 0 })}
          disabled={off}
        >
          {PAGE.reset}
        </button>
        {children}
      </div>
    </div>
  )
}
