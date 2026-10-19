import { useState } from 'react'
import { CASES, titleOf } from './cases.ts'
import { LabCard } from './LabCard.tsx'
import css from './lab.css?inline'

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
  const title = titleOf(labCase)

  const pick = (key: string) => {
    const next = CASES.find((candidate) => candidate.key === key) ?? CASES[0]
    setLabCase(next)
    const search = params()
    search.set('case', next.key)
    history.replaceState(history.state, '', `?${search}`)
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
            its opening. Every choice stays in the address, so a link shows the same card.
          </p>
        </section>
        <p className="ab-lab-case" aria-live="polite">
          <b>{labCase.label}:</b> {labCase.note}
        </p>
        <div id="ab-lab-stage" className="ab-lab-stage" tabIndex={-1}>
          <LabCard title={title} mode="inline" onClose={backToChoices} />
        </div>
      </main>
      {opened && (
        <LabCard title={title} mode="card" from={opened} onClose={() => setOpened(null)} />
      )}
    </div>
  )
}
