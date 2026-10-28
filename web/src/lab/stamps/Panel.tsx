import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { getSnapshot, listedIn, subscribe } from '../../features/list/store.ts'
import { allSaved, changeOne, clear, fillPlan, setStates, stateOf, STATES } from './sandbox.ts'
import {
  COLORS,
  SECTIONS,
  LOOKS,
  summary,
  SURFACES,
  SWITCHES,
  WIDTHS,
  type Options,
  type View,
} from './switches.ts'

const STATE_NAMES = ['Saved', 'Saved, favorite', 'Want to try', 'Want to try, favorite']

/**
 * The lab's switches: a side panel from 900px, a sheet at the screen's foot on a phone, opened by
 * its bar. First the lab's list and the view, then S1 to S8, each starting on the recommended
 * option, then Reset.
 */
export function Panel({
  options,
  view,
  matches,
  onOptions,
  onView,
  onJump,
  onReset,
}: {
  options: Options
  view: View
  /** The matches' ids as the stage shows them, for Fill 4 states. */
  matches: number[]
  onOptions: (options: Options) => void
  onView: (view: View) => void
  onJump: (section: number) => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(false)
  const list = useSyncExternalStore(subscribe, getSnapshot)
  const ids = listedIn(list)
  const plan = fillPlan(matches)
  const first = plan[0][0]
  const firstState = stateOf(list, first)
  const choose = (patch: Partial<Options>) => onOptions({ ...options, ...patch })
  return (
    <aside className={open ? 'ab-lab-panel is-open' : 'ab-lab-panel'} aria-label="Switches">
      <button
        type="button"
        className="ab-lab-handle"
        aria-expanded={open}
        aria-controls="ab-lab-switches"
        onClick={() => setOpen(!open)}
      >
        <b>Switches:</b> <span>{summary(options)}</span>
      </button>
      <div id="ab-lab-switches" className="ab-lab-switches">
        <div className="ab-lab-sheet-top">
          <p className="ab-lab-intro">
            Each switch starts on the option marked <span className="ab-lab-rec">Recommended</span>.
            The address keeps your picks, so a link shows the same setup.
          </p>
          <button
            type="button"
            className="ab-lab-close"
            aria-label="Close the switches"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>
        <Group title="The lab’s list">
          <p className="ab-lab-why" aria-live="polite">
            On the lab’s list: <b>{ids.length}</b>. Kept in this browser under
            anibeam:lab-stamps:v1; your own list is never read or written.
          </p>
          <div className="ab-lab-row">
            <button type="button" className="ab-lab-button" onClick={() => setStates(plan)}>
              Fill 4 states
            </button>
            <button type="button" className="ab-lab-button" onClick={() => changeOne(first)}>
              Change one
            </button>
            <button type="button" className="ab-lab-button" onClick={allSaved}>
              All saved
            </button>
            <button type="button" className="ab-lab-button" onClick={clear}>
              Clear
            </button>
          </div>
          <p className="ab-lab-why">
            Change one moves trending panel 4 on to the next state: now{' '}
            <b>
              {firstState
                ? STATE_NAMES[
                    STATES.findIndex(
                      (state) =>
                        state.status === firstState.status &&
                        state.favorite === firstState.favorite,
                    )
                  ]
                : 'not listed'}
            </b>
            .
          </p>
        </Group>
        <Group title="View">
          <Radios
            name="ab-lab-width"
            legend="Frame width"
            value={view.width}
            options={WIDTHS.map((width) => [width, width === 'fit' ? 'Fit' : width])}
            onChange={(width) => onView({ ...view, width })}
          />
          <Radios
            name="ab-lab-motion"
            legend="Motion"
            value={view.motion}
            options={[
              ['device', 'As my device'],
              ['reduce', 'Reduce'],
            ]}
            onChange={(motion) => onView({ ...view, motion })}
          />
          <label className="ab-lab-check">
            <input
              type="checkbox"
              checked={view.clips}
              onChange={(event) => onView({ ...view, clips: event.target.checked })}
            />
            <span>Show clip boxes</span>
          </label>
          <div className="ab-lab-row" role="group" aria-label="Go to a section">
            {SECTIONS.map((name, i) => (
              <button
                key={name}
                type="button"
                className="ab-lab-see"
                onClick={() => {
                  setOpen(false)
                  onJump(i + 1)
                }}
              >
                {i + 1}. {name}
              </button>
            ))}
          </div>
        </Group>
        <Choices
          num="S1"
          name="s1"
          legend="Which look do stamps take?"
          value={options.s1}
          options={LOOKS}
          onChange={(s1) => choose({ s1, s2: COLORS[s1][0].value })}
        />
        <Choices
          num="S2"
          name="s2"
          legend="Which colors? (they follow S1)"
          value={options.s2}
          options={COLORS[options.s1]}
          disabled={options.s1 === 'c'}
          onChange={(s2) => choose({ s2 })}
        />
        {SWITCHES.filter(({ key }) => key !== 's1').map(({ key, num, legend, options: list }) => (
          <Choices
            key={key}
            num={num}
            name={key}
            legend={legend}
            value={options[key]}
            options={list}
            onChange={(value) => choose({ [key]: value })}
            after={
              key === 's5' ? (
                <Surfaces value={options.s6} onChange={(s6) => choose({ s6 })} />
              ) : undefined
            }
          />
        ))}
        <button type="button" className="ab-lab-button" onClick={onReset}>
          Reset every switch to the recommended
        </button>
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

/** One switch, numbered, as real radios. */
function Choices<Value extends string>({
  num,
  name,
  legend,
  value,
  options,
  disabled = false,
  onChange,
  after,
}: {
  num: string
  name: string
  legend: string
  value: Value
  options: { value: Value; label: string; recommended?: boolean; note: string }[]
  disabled?: boolean
  onChange: (value: Value) => void
  after?: ReactNode
}) {
  const picked = options.find((option) => option.value === value)
  return (
    <>
      <fieldset className="ab-lab-switch" data-switch={num} disabled={disabled}>
        <legend>
          <b className="ab-lab-num">{num}</b> {legend}
        </legend>
        <div className="ab-lab-options">
          {options.map((option) => (
            <label key={option.value} className="ab-chip">
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                data-recommended={option.recommended ? '' : undefined}
                onChange={() => onChange(option.value)}
              />
              <span>
                {option.label}
                {option.recommended && <small className="ab-lab-rec">Recommended</small>}
              </span>
            </label>
          ))}
        </div>
        {picked && <p className="ab-lab-why">{picked.note}</p>}
      </fieldset>
      {after}
    </>
  )
}

/** S6, as checkboxes. */
function Surfaces({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <fieldset className="ab-lab-switch" data-switch="S6">
      <legend>
        <b className="ab-lab-num">S6</b> Which surfaces get stamps?
      </legend>
      <div className="ab-lab-options">
        {SURFACES.map(({ letter, label, recommended }) => (
          <label key={letter} className="ab-lab-check">
            <input
              type="checkbox"
              name="s6"
              value={letter}
              checked={value.includes(letter)}
              data-recommended={recommended ? '' : undefined}
              onChange={(event) =>
                onChange(
                  SURFACES.map((surface) => surface.letter)
                    .filter((each) =>
                      each === letter ? event.target.checked : value.includes(each),
                    )
                    .join(''),
                )
              }
            />
            <span>
              {label}
              {recommended && <small className="ab-lab-rec">Recommended</small>}
            </span>
          </label>
        ))}
      </div>
      <p className="ab-lab-why">
        The rolled card is off by default: its My List buttons sit right beside it, its flipping
        faces clip, and a stamp on it risks flicker in Safari. A roll never gives a listed title, so
        press Save beside the rolled card to see it.
      </p>
    </fieldset>
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
  options: (readonly [Value, string])[]
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
