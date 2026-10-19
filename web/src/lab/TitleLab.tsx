import { useState } from 'react'
import { CASES, titleOf } from './cases.ts'
import { CHOICES, optionsIn, type Choice, type Options } from './choices.ts'
import { LabCard } from './LabCard.tsx'
import css from './lab.css?inline'
import { TITLES } from './titles.ts'

// What the lab shows, kept in the address (?proto=title&case=aot…), so a link opens the same view
// and a reload keeps it.
const params = () => new URLSearchParams(location.search)
const initialCase = () => CASES.find(({ key }) => key === params().get('case')) ?? CASES[0]

/**
 * Draft PR 11's title lab, at ?proto=title: the title card drawn from saved AniList answers (see
 * titles.ts), for the title page's open choices. It never merges. It is its own chunk, fetched
 * only at its address, and it asks AniList's API for nothing: the covers and banners still come
 * from AniList's image server, as on the site. Its stylesheet comes inline with its code, so the
 * site's own stylesheet is the same without it.
 */
export default function TitleLab() {
  const [labCase, setLabCase] = useState(initialCase)
  const [choicesOpen, setChoicesOpen] = useState(() => innerWidth >= 1000)
  // The card open over the lab, and the button it grew from.
  const [opened, setOpened] = useState<DOMRect | null>(null)
  const [options, setOptions] = useState(() => optionsIn(params()))
  const title = titleOf(labCase)

  const remember = (key: string, value: string) => {
    const search = params()
    search.set(key, value)
    history.replaceState(history.state, '', `?${search}`)
  }
  const pick = (key: string) => {
    const next = CASES.find((candidate) => candidate.key === key) ?? CASES[0]
    setLabCase(next)
    remember('case', next.key)
  }
  const choose = (key: keyof Options, value: string) => {
    setOptions({ ...options, [key]: value })
    remember(key, value)
  }
  const backToChoices = () => {
    setChoicesOpen(true)
    requestAnimationFrame(() => document.getElementById('ab-lab-choices')?.focus())
  }

  return (
    <div className="ab-lab">
      <title>Title lab · AniBeam</title>
      <style>{css}</style>
      <a className="ab-skip" href="#ab-lab-stage">
        Skip to the title
      </a>
      <header className="ab-lab-bar">
        <h1 className="ab-lab-name">
          AniBeam <b>Title lab</b> <small>Draft, never merged</small>
        </h1>
        <label className="ab-lab-pick">
          <span>Title</span>
          <select value={labCase.key} onChange={(event) => pick(event.target.value)}>
            {CASES.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ab-lab-button"
          aria-expanded={choicesOpen}
          aria-controls="ab-lab-choices"
          onClick={() => setChoicesOpen(!choicesOpen)}
        >
          Choices
        </button>
        <button
          type="button"
          className="ab-lab-button ab-lab-button-ink"
          onClick={(event) => setOpened(event.currentTarget.getBoundingClientRect())}
        >
          Open as the card
        </button>
      </header>
      <main id="main" className="ab-lab-main">
        <section
          id="ab-lab-choices"
          className="ab-lab-choices"
          aria-label="Choices"
          tabIndex={-1}
          hidden={!choicesOpen}
        >
          <p className="ab-lab-intro">
            The title page&rsquo;s open choices, drawn from AniList answers saved during the
            research, so this page asks AniList for nothing. Pick a title above, then switch each
            choice and look at the card below; <b>Open as the card</b> opens it full screen, with
            its opening. Every choice stays in the address, so a link shows the same card. Options
            marked <span className="ab-lab-rec">Recommended</span> are the plan&rsquo;s.
          </p>
          {CHOICES.map((choice) => (
            <ChoiceSet
              key={choice.key}
              choice={choice}
              options={options}
              onChoose={(value) => choose(choice.key, value)}
            />
          ))}
        </section>
        <p className="ab-lab-case" aria-live="polite">
          <b>{labCase.label}:</b> {labCase.note} {bannerLine(title.bannerImage, title.bannerBytes)}
        </p>
        <div id="ab-lab-stage" className="ab-lab-stage" tabIndex={-1}>
          <LabCard title={title} options={options} mode="inline" onClose={backToChoices} />
        </div>
      </main>
      {opened && (
        <LabCard
          title={title}
          options={options}
          mode="card"
          from={opened}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  )
}

// Each banner's load time on a 390px phone in Chrome's "Fast 3G" emulation (562.5 ms round trip,
// 1.44 Mbps down, the throttling Lighthouse applies for phones), the same in two runs on
// 2026-10-19: Chrome's emulation, not a real phone.
const FAST_3G_MS: Record<number, number> = {
  154587: 1650,
  16498: 1610,
  1: 2320,
  207329: 1340,
  21: 2780,
}

const kb = (bytes: number) => `${Math.round(bytes / 1000)} KB`

/** What the case's banner weighs, for the line under the choices. */
function bannerLine(banner: string | null, bytes: number | null) {
  if (!banner) return 'No banner.'
  if (bytes === null) return 'Its banner fails to load.'
  return `Banner: ${kb(bytes)}.`
}

/** One choice: its options as radio buttons, what it weighs, and what it needs to show. */
function ChoiceSet({
  choice,
  options,
  onChoose,
}: {
  choice: Choice
  options: Options
  onChoose: (value: string) => void
}) {
  const off = choice.needs && options[choice.needs.key] !== choice.needs.value
  return (
    <fieldset className="ab-lab-choice" disabled={off}>
      <legend>{choice.legend}</legend>
      <div className="ab-lab-options">
        {choice.options.map(({ value, label, recommended }) => (
          <label key={value} className="ab-chip">
            <input
              type="radio"
              name={choice.key}
              value={value}
              checked={options[choice.key] === value}
              onChange={() => onChoose(value)}
            />
            <span>
              {label}
              {recommended && <small className="ab-lab-rec">Recommended</small>}
            </span>
          </label>
        ))}
      </div>
      <p className="ab-lab-why">
        {off && <b>{choice.needs?.why} </b>}
        {choice.note}
      </p>
      {choice.key === 'phone' && (
        <ul className="ab-lab-weights" aria-label="Banner weights">
          {TITLES.map(({ id, title, bannerBytes }) => (
            <li key={id}>
              {title.english ?? title.romaji}: <b>{bannerBytes ? kb(bannerBytes) : 'no banner'}</b>
              {FAST_3G_MS[id] && `, ${(FAST_3G_MS[id] / 1000).toFixed(1)} s`}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
