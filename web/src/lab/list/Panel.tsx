import { useState, type ReactNode } from 'react'
import { titleOf } from '../../features/anime/format.ts'
import { LAB_TITLES, titleFor } from './pool.ts'
import { entryOf, fill60, listedIds, reset, setEntry, twelve, useList } from './sandbox.ts'
import { DEFAULTS, SECTIONS, SWITCHES, type Lab, type Options } from './switches.ts'

const STATES: [Lab['state'], string][] = [
  ['list', 'Your list'],
  ['loading', 'Loading'],
  ['offline', 'Offline, titles cached'],
  ['offline-empty', 'Offline, nothing cached'],
  ['outage', 'AniList unavailable'],
  ['missing', 'Titles missing'],
]
const STORAGE: [Lab['storage'], string][] = [
  ['works', 'Saving works'],
  ['full', 'Storage full'],
  ['cap', 'At the 2,000 cap'],
]
const WIDTHS: [Lab['width'], string][] = [
  ['fit', 'The room there is'],
  ['280', '280'],
  ['390', '390'],
  ['768', '768'],
  ['1440', '1440'],
]
/** The card's five states for its title (see Card states). */
const ENTRY_STATES = [
  { label: 'None', entry: null },
  { label: 'Saved', entry: { status: 'SAVED', favorite: false } },
  { label: 'Want to try', entry: { status: 'WANT', favorite: false } },
  { label: 'Saved, Favorite', entry: { status: 'SAVED', favorite: true } },
  { label: 'Want to try, Favorite', entry: { status: 'WANT', favorite: true } },
] as const

/**
 * The lab's switches: a side panel on a laptop, a sheet at the screen's foot on a phone, opened
 * by its handle. First what the lab shows (the sandbox list, the stage's width and states), then
 * one switch per open choice, numbered by its decision, each starting on the plan's
 * recommendation.
 */
export function Panel({
  options,
  lab,
  onChoose,
  onLab,
  onReplay,
}: {
  options: Options
  lab: Lab
  onChoose: (key: keyof Options, value: string) => void
  onLab: (patch: Partial<Lab>) => void
  onReplay: () => void
}) {
  const [open, setOpen] = useState(false)
  const list = useList()
  const ids = listedIds(list)
  const favorites = ids.filter((id) => entryOf(list, id)?.favorite).length
  const changed = SWITCHES.filter(({ key }) => options[key] !== DEFAULTS[key]).length
  const entry = entryOf(list, lab.title)
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
          Each switch is numbered by its decision in the Phase 4 plan, and starts on the option
          marked <span className="ab-lab-rec">Recommended</span>. Pick one on every switch; the lab
          keeps your picks in the address, so a link shows the same view.
        </p>
        <Group title="The lab’s list">
          <p className="ab-lab-why" aria-live="polite">
            On the lab’s list: <b>{ids.length}</b>
            {ids.length > 0 && ` (${favorites} ${favorites === 1 ? 'Favorite' : 'Favorites'})`}.
            Kept in this browser under anibeam:lab-list, so a reload keeps it; the site’s own list
            is untouched.
          </p>
          <div className="ab-lab-row">
            <button type="button" className="ab-lab-button" onClick={twelve}>
              Twelve titles
            </button>
            <button type="button" className="ab-lab-button" onClick={fill60}>
              Fill 60
            </button>
            <button type="button" className="ab-lab-button" onClick={reset}>
              Reset
            </button>
          </div>
        </Group>
        <Group title="What the stage shows">
          <label className="ab-lab-pick">
            <span>Title on the card</span>
            <select
              value={lab.title}
              onChange={(event) => onLab({ title: Number(event.target.value) })}
            >
              {LAB_TITLES.map((id) => {
                const media = titleFor(id)
                return (
                  media && (
                    <option key={id} value={id}>
                      {titleOf(media)}
                      {media.bannerImage ? '' : ' (no banner)'}
                    </option>
                  )
                )
              })}
            </select>
          </label>
          <Radios
            name="ab-lab-entry"
            legend="Its state"
            value={ENTRY_STATES.findIndex(
              ({ entry: state }) =>
                (state === null && !entry) ||
                (state !== null &&
                  entry?.status === state.status &&
                  entry.favorite === state.favorite),
            )}
            options={ENTRY_STATES.map(({ label }, i) => [i, label])}
            onChange={(i) => setEntry(lab.title, ENTRY_STATES[i].entry)}
          />
          <Radios
            name="ab-lab-storage"
            legend="Saving"
            value={lab.storage}
            options={STORAGE}
            onChange={(storage) => onLab({ storage })}
          />
          <Radios
            name="ab-lab-state"
            legend="My List page"
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
          <div className="ab-lab-row">
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

function Radios<Value extends string | number>({
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
