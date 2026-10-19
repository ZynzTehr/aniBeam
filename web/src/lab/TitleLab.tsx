import { useRef, useState, type ReactNode } from 'react'
import { NOT_FOUND } from '../app/status.ts'
import { TitleNotice } from '../components/TitleNotice.tsx'
import { CASES, titleOf } from './cases.ts'
import { CHOICES, optionsIn, type Choice, type Options } from './choices.ts'
import delaKanji from './dela-kanji.woff2?inline'
import { LabCard } from './LabCard.tsx'
import css from './lab.css?inline'
import { TITLES } from './titles.ts'

// Dela Gothic One's own glyphs for the 36 kanji and 7 marks in the saved titles' Japanese names,
// 6.8 KB, cut from the font by Google Fonts' text= option on 2026-10-19 and kept here, so the lab
// asks Google for nothing (OFL, as web/public/fonts/OFL.txt). Only "Now: Dela Gothic One's own"
// uses it (see .ab-lab-dela in lab.css).
const DELA_KANJI = `@font-face { font-family: 'AB Lab Dela Kanji'; src: url(${delaKanji}) format('woff2'); }`

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
  // "Details arrive late": the details leave for 1.5 s, as while their request runs.
  const [late, setLate] = useState(false)
  const lateTimer = useRef(0)
  const [noteOpen, setNoteOpen] = useState(false)

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
  const showStage = () =>
    document.getElementById('ab-lab-stage')?.scrollIntoView({ block: 'start' })
  const arriveLate = () => {
    showStage()
    setLate(true)
    clearTimeout(lateTimer.current)
    lateTimer.current = window.setTimeout(() => setLate(false), 1500)
  }
  const see = (key: string) => {
    pick(key)
    requestAnimationFrame(showStage)
  }
  const backToChoices = () => {
    setChoicesOpen(true)
    requestAnimationFrame(() => document.getElementById('ab-lab-choices')?.focus())
  }
  // The dock's two jumps, for a phone, where the choices run to about 3,000px above the card.
  const toChoices = () => {
    setChoicesOpen(true)
    requestAnimationFrame(() => {
      const choices = document.getElementById('ab-lab-choices')
      choices?.scrollIntoView({ block: 'start' })
      choices?.focus({ preventScroll: true })
    })
  }
  const toCard = () => {
    showStage()
    document.getElementById('ab-lab-stage')?.focus({ preventScroll: true })
  }

  return (
    <div className="ab-lab">
      <title>Title lab · AniBeam</title>
      <style>{css + DELA_KANJI}</style>
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
            >
              {choice.key === 'kanji' && title.title.native && (
                <KanjiSample native={title.title.native} />
              )}
              {choice.key === 'align' && (
                <button type="button" className="ab-lab-button" onClick={arriveLate}>
                  Details arrive late
                </button>
              )}
            </ChoiceSet>
          ))}
          <section className="ab-lab-choice" aria-labelledby="ab-lab-copy">
            <h2 id="ab-lab-copy" className="ab-lab-legend">
              New copy, to approve in one pass
            </h2>
            <ul className="ab-lab-copy">
              <CopyLine text="Watch trailer" onSee={() => see('frieren')}>
                The last button in the card, only for a title with a trailer (Ten Tokyo Warriors and
                One Piece have none).
              </CopyLine>
              <CopyLine text="Open on YouTube" onSee={() => see('aot')}>
                In the trailer&rsquo;s dialog, if the video fails: press Watch trailer.
              </CopyLine>
              <CopyLine text="Show spoiler tags" onSee={() => see('aot')}>
                Under the tags, where a title has spoiler tags (Attack on Titan has 9).
              </CopyLine>
              <CopyLine text="Description unavailable." onSee={() => see('nodescription')}>
                In place of the synopsis, when AniList has none.
              </CopyLine>
              <CopyLine text={NOT_FOUND} onSee={() => setNoteOpen(true)} seeLabel="Show the note">
                The note for an address AniList can&rsquo;t give, on the site since #21.
              </CopyLine>
            </ul>
            <p className="ab-lab-why">
              Clamped, the synopsis also needs &ldquo;Read more&rdquo; and &ldquo;Show less&rdquo;.
            </p>
          </section>
        </section>
        <nav className="ab-lab-dock" aria-label="The lab">
          <p className="ab-lab-picks">
            <b>Picked:</b> {picksOf(options)}
          </p>
          <div className="ab-lab-jumps">
            <button type="button" className="ab-lab-see" onClick={toChoices}>
              Choices
            </button>
            <button type="button" className="ab-lab-see ab-lab-see-ink" onClick={toCard}>
              See the card
            </button>
          </div>
        </nav>
        <p className="ab-lab-case" aria-live="polite">
          <b>{labCase.label}:</b> {labCase.note} {bannerLine(title.bannerImage, title.bannerBytes)}
        </p>
        <div id="ab-lab-stage" className="ab-lab-stage" tabIndex={-1}>
          <LabCard
            title={title}
            options={options}
            mode="inline"
            late={late}
            onClose={backToChoices}
          />
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
      {noteOpen && <TitleNotice text={NOT_FOUND} onClose={() => setNoteOpen(false)} />}
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

/** The current picks in a line ("Band · strip · top · …"), the phone choice only with the band. */
function picksOf(options: Options) {
  return CHOICES.filter(({ needs }) => !needs || options[needs.key] === needs.value)
    .map(({ key, options: each }) => each.find(({ value }) => value === options[key])?.short)
    .join(' · ')
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
  children,
}: {
  choice: Choice
  options: Options
  onChoose: (value: string) => void
  children?: ReactNode
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
      {children}
    </fieldset>
  )
}

/** A line of new copy, where it shows, and a button that shows it there. */
function CopyLine({
  text,
  onSee,
  seeLabel = 'See it',
  children,
}: {
  text: string
  onSee: () => void
  seeLabel?: string
  children: ReactNode
}) {
  return (
    <li>
      <q>{text}</q> <span>{children}</span>{' '}
      <button
        type="button"
        className="ab-lab-see"
        aria-label={`${seeLabel}: ${text}`}
        onClick={onSee}
      >
        {seeLabel}
      </button>
    </li>
  )
}

/**
 * The title's Japanese name in both faces, side by side and large, as the watermark draws it:
 * behind the cover, the card shows only a sliver of it.
 */
function KanjiSample({ native }: { native: string }) {
  const sample = [...native].slice(0, 8).join('')
  return (
    <div className="ab-lab-kanji" lang="ja" aria-hidden="true">
      <figure>
        <p>{sample}</p>
        <figcaption>Heavy system font (today)</figcaption>
      </figure>
      <figure className="ab-lab-dela">
        <p>{sample}</p>
        <figcaption>Dela Gothic One</figcaption>
      </figure>
    </div>
  )
}
