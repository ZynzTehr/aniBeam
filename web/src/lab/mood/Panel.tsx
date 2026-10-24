import { useState, type ReactNode } from 'react'
import { useListIds } from '../../features/list/store.ts'
import type { Command } from './MoodLab.tsx'
import { DEFAULTS, SECTIONS, STATES, SWITCHES, type Lab, type Options } from './switches.ts'
import { LAB_ERAS } from './titles.ts'

const WIDTHS: [Lab['width'], string][] = [
  ['fit', 'The room there is'],
  ['280', '280'],
  ['390', '390'],
  ['768', '768'],
  ['1440', '1440'],
]

/**
 * The lab's switches: a side panel on a laptop, a sheet at the screen's foot on a phone, opened by
 * its handle. First what the lab shows (the sandbox list, the stage's state and width), then one
 * switch per open choice, numbered by its decision, each starting on the plan's recommendation.
 */
export function Panel({
  options,
  lab,
  onChoose,
  onLab,
  onReplay,
  onCommand,
}: {
  options: Options
  lab: Lab
  onChoose: (key: keyof Options, value: string) => void
  onLab: (patch: Partial<Lab>) => void
  onReplay: () => void
  onCommand: (what: Command) => void
}) {
  const [open, setOpen] = useState(false)
  // The lab's list, read through the site's own store (see sandbox.ts).
  const listed = useListIds().length
  const changed = SWITCHES.filter(({ key }) => options[key] !== DEFAULTS[key]).length
  const onMood = lab.section === 'mood'
  const onList = lab.section !== 'wording'
  return (
    <aside className={open ? 'ab-lab-panel is-open' : 'ab-lab-panel'} aria-label="Switches">
      <button
        type="button"
        className="ab-lab-handle"
        aria-expanded={open}
        aria-controls="ab-lab-switches"
        onClick={() => setOpen(!open)}
      >
        <b>Switches</b>{' '}
        <span>
          {changed === 0
            ? `All ${SWITCHES.length} as recommended`
            : `${changed} of ${SWITCHES.length} changed`}
        </span>
      </button>
      <div id="ab-lab-switches" className="ab-lab-switches">
        <p className="ab-lab-intro">
          Each switch is numbered by its decision in the Phase 5 plan, and starts on the option
          marked <span className="ab-lab-rec">Recommended</span>. Pick one on every switch; the lab
          keeps your picks in the address, so a link shows the same view. The lab scores with every
          recorded tag; the site keeps every tag the mood map uses.
        </p>
        <Group title="Try it">
          <div className="ab-lab-row">
            <button
              type="button"
              className="ab-lab-button"
              disabled={!onMood}
              onClick={() => onCommand('roll20')}
            >
              Roll 20
            </button>
            <label className="ab-lab-check">
              <input
                type="checkbox"
                checked={lab.motion === 'reduce'}
                onChange={(event) => onLab({ motion: event.target.checked ? 'reduce' : 'full' })}
              />
              <span>Reduce motion</span>
            </label>
            <button type="button" className="ab-lab-button" onClick={onReplay}>
              Replay
            </button>
          </div>
          <div className="ab-lab-row">
            <label className="ab-lab-check">
              <input
                type="checkbox"
                checked={lab.scores === 'on'}
                onChange={(event) => onLab({ scores: event.target.checked ? 'on' : 'off' })}
              />
              <span>Show scores</span>
            </label>
            <label className="ab-lab-check">
              <input
                type="checkbox"
                checked={lab.spoilers === 'on'}
                onChange={(event) => onLab({ spoilers: event.target.checked ? 'on' : 'off' })}
              />
              <span>Spoiler check</span>
            </label>
          </div>
        </Group>
        <Group title="The lab’s list">
          <p className="ab-lab-why">
            On the lab’s list: <b data-lab="listed">{listed}</b>. Kept in this browser under
            anibeam:lab-list; the site’s own list is never read or touched.
          </p>
          <div className="ab-lab-row">
            <button
              type="button"
              className="ab-lab-button"
              disabled={!onList}
              onClick={() => onCommand('twenty')}
            >
              Put 20 matches on My List
            </button>
            <button
              type="button"
              className="ab-lab-button"
              disabled={!onList}
              onClick={() => onCommand('leave3')}
            >
              Leave 3
            </button>
            <button
              type="button"
              className="ab-lab-button"
              disabled={!onList}
              onClick={() => onCommand('drain')}
            >
              Empty the pool
            </button>
            <button type="button" className="ab-lab-button" onClick={() => onCommand('reset')}>
              Reset
            </button>
          </div>
          <p className="ab-lab-why">
            On the Mood page, “Leave 3” lists all but 3 of the era, so the next roll shows page 3
            being fetched (a simulated request), and “Empty the pool” lists them all; on section 2,
            they act on Discover’s machine.
          </p>
        </Group>
        <Group title="What the stage shows">
          <Radios
            name="ab-lab-state"
            legend="State"
            value={lab.state}
            options={STATES}
            onChange={(state) => onLab({ state })}
          />
          <Radios
            name="ab-lab-width"
            legend="Width"
            value={lab.width}
            options={WIDTHS}
            onChange={(width) => onLab({ width })}
          />
          <label className="ab-lab-pick">
            <span>The decade last picked on Discover (for A13)</span>
            <select
              value={lab.last}
              onChange={(event) => onLab({ last: event.target.value as Lab['last'] })}
            >
              {LAB_ERAS.filter(({ id }) => id !== 'any').map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </Group>
        {SWITCHES.map((choice) => (
          <fieldset key={choice.key} className="ab-lab-switch" data-decision={choice.decision}>
            <legend>
              <b className="ab-lab-num">{choice.decision}</b> {choice.legend}
            </legend>
            <div className="ab-lab-options">
              {choice.options.map(({ value, label, recommended }) => (
                <label key={value} className="ab-chip">
                  <input
                    type="radio"
                    name={choice.key}
                    value={value}
                    checked={options[choice.key] === value}
                    data-recommended={recommended ? '' : undefined}
                    onChange={() => onChoose(choice.key, value)}
                  />
                  <span>
                    {label}
                    {recommended && <small className="ab-lab-rec">Recommended</small>}
                  </span>
                </label>
              ))}
            </div>
            <p className="ab-lab-why">{choice.note}</p>
            {choice.section !== lab.section && (
              <button
                type="button"
                className="ab-lab-see"
                onClick={() => {
                  setOpen(false)
                  onLab({ section: choice.section })
                }}
              >
                See it: {SECTIONS.find(({ key }) => key === choice.section)?.name}
              </button>
            )}
          </fieldset>
        ))}
      </div>
    </aside>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ab-lab-group" aria-label={title}>
      <h2 className="ab-lab-legend">{title}</h2>
      {children}
    </section>
  )
}

function Radios<Value extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string
  legend: string
  value: Value
  options: readonly (readonly [Value, string])[]
  onChange: (value: Value) => void
}) {
  return (
    <fieldset className="ab-lab-radios">
      <legend>{legend}</legend>
      <div className="ab-lab-options">
        {options.map(([option, label]) => (
          <label key={option} className="ab-chip">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
