import { useId } from 'react'
import { AXES, wordOf, type Axis, type Stop } from './moods.ts'
import './MoodSlider.css'

/**
 * A mood slider (spec §3C): a native range input from -2 to 2, one step a stop, so the browser
 * gives it the keyboard (the arrows, Home, End and the Page keys), touch and a screen reader's
 * controls. Its label names the axis, and aria-valuetext is the stop's word alone, such as "Very
 * cozy": "Energy: very cozy" would have the name read twice. The word also shows beside the label
 * as plain text, hidden from screen readers, which hear it from the input; an <output> would be
 * read a second time as it changes.
 */
export function MoodSlider({
  axis,
  value,
  onChange,
}: {
  axis: Axis
  value: Stop
  onChange: (value: Stop) => void
}) {
  const id = useId()
  const { label, ends } = AXES[axis]
  const word = wordOf(axis, value)
  return (
    <div className="ab-slider">
      <div className="ab-slider-head">
        <label className="ab-slider-name" htmlFor={id}>
          {label}
        </label>
        <span className="ab-slider-value" aria-hidden="true">
          {word}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={-2}
        max={2}
        step={1}
        value={value}
        aria-valuetext={word}
        onChange={(event) => onChange(Number(event.target.value) as Stop)}
      />
      <div className="ab-slider-ends" aria-hidden="true">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </div>
  )
}
