import { useState, type ReactNode } from 'react'
import { noteFor, sampleNote, searchStatus, statusText } from '../app/status.ts'
import { IntroHero } from '../components/IntroHero.tsx'
import { MangaPage, PANELS } from '../components/MangaPage.tsx'
import { MotionSwitch } from '../components/MotionSwitch.tsx'
import { RetryButton } from '../components/RetryButton.tsx'
import { SiteHeader } from '../components/SiteHeader.tsx'
import { Strip } from '../components/Strip.tsx'
import { TitleCard, type OpenTitle } from '../components/TitleCard.tsx'
import type { Media } from '../features/anime/queries.ts'
import { SAMPLES } from '../features/anime/samples.ts'
import { AXES, type Axis, type Stop } from '../features/mood/moods.ts'
import { MoodSlider } from '../features/mood/MoodSlider.tsx'
import { PullMachine } from '../features/mood/PullMachine.tsx'
import { accentVars, deriveAccent, DOTTED_PAPER, INK } from '../features/theming/deriveAccent.ts'
import { contrast } from '../lib/color.ts'
import { ECCHI_POOL, mediaOf, STATES, STATUS_CASES, TITLE_CASES, type State } from './cases.ts'
import './gallery.css'

// Tailwind doesn't read this folder (see styles/index.css): the word capitalize here is a canary,
// which privacy.test.ts looks for in the production stylesheet.

// The title cases as titles, and the samples split up so that no title shows twice in a section.
const CASES = TITLE_CASES.map(mediaOf)
const FAVORITES = SAMPLES.slice(0, 9)
const FOUR = SAMPLES.slice(9, 13)
const ROW = SAMPLES.slice(13)
// The intro leaves small covers out of its fan (see coverFan), so these are the cases with gaps
// it can show: no color, a cover that fails to load, and no banner.
const GAPS = [3, 6, 0].map((i) => CASES[i])
const noop = () => {}

/**
 * AniBeam's components on one page, for judging the design without AniList: real sample titles,
 * forced edge cases (see cases.ts) and every state a section can be in. Development only, at
 * ?gallery (see main.tsx); it makes no request to AniList. Its root is .ab-app with <main
 * id="main">, as the app's, so the components look as they do there.
 */
export default function Gallery() {
  // The header's search box shows what is typed, and searches nothing.
  const [search, setSearch] = useState('')
  // The title card open, if any, and where it opened from, as in the app.
  const [opened, setOpened] = useState<{ media: Media; from: DOMRect } | null>(null)
  const open: OpenTitle = (media, from) => setOpened({ media, from: from.getBoundingClientRect() })
  return (
    <div className="ab-app">
      <a className="ab-skip" href="#main">
        Skip to content
      </a>
      <SiteHeader
        links={[
          { href: '#gal-titles', label: 'Titles' },
          { href: '#gal-states', label: 'Sections' },
          { href: '#gal-lines', label: 'Status lines' },
          { href: '#gal-controls', label: 'Controls' },
          { href: '#gal-slider', label: 'Sliders' },
          { href: '#gal-later', label: 'Later', soon: true },
        ]}
        search={search}
        onSearch={(shown) => setSearch(shown)}
      />
      <main id="main" className="gal">
        <header className="gal-head">
          <h1>AniBeam component gallery</h1>
          <p>
            Development only. Every component on real sample titles, with the gaps real AniList
            titles have, and every state a section can be in. Nothing here asks AniList&rsquo;s API
            for anything; the covers come from its image server, as in the app.
          </p>
        </header>
        <TitleCases onOpen={open} />
        <SectionStates onOpen={open} />
        <StatusLines />
        <Controls />
        <Sliders />
      </main>
      <footer className="ab-foot">
        <MotionSwitch id="reduce-motion" />
        <p>Data from AniList. AniBeam is not affiliated with AniList.</p>
      </footer>
      {opened && (
        <TitleCard
          key={opened.media.id}
          media={opened.media}
          from={opened.from}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  )
}

/** A part of the gallery, under its heading. */
function Part({
  id,
  heading,
  note,
  children,
}: {
  id: string
  heading: string
  note: ReactNode
  children: ReactNode
}) {
  return (
    <section className="gal-part" aria-labelledby={id}>
      {/* tabIndex -1: the header's links move focus here, but Tab skips it. */}
      <h2 id={id} className="gal-title" tabIndex={-1}>
        {heading}
      </h2>
      <p className="gal-note">{note}</p>
      {children}
    </section>
  )
}

/** The title cases, each like a real AniList title, on a manga page and a strip. */
function TitleCases({ onOpen }: { onOpen: OpenTitle }) {
  return (
    <Part
      id="gal-titles"
      heading="Title cases"
      note="Each case is a sample title with one gap forced, a gap a real AniList title has. Case n is panel n on the page and Ch.n on the strip; open any of them for its title card."
    >
      <ol className="gal-cases">
        {TITLE_CASES.map((edge) => (
          <li key={edge.from}>
            <b>{edge.label}</b> <span>like {edge.like}</span>
          </li>
        ))}
      </ol>
      <MangaPage
        id="gal-panels"
        heading="On the trending page"
        sfx="ドン!"
        titles={CASES.slice(0, PANELS)}
        onOpen={onOpen}
      />
      <Strip id="gal-strip" heading="On a strip" sfx="バーン" titles={CASES} onOpen={onOpen} />
    </Part>
  )
}

/** One case or state, under its label. */
function Case({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="gal-case" data-case={label}>
      <figcaption>{label}</figcaption>
      {children}
    </figure>
  )
}

/** Each state of a section, one after another. */
function Each<S extends string>({
  group,
  states,
  render,
}: {
  group: string
  states: readonly S[]
  render: Record<S, ReactNode>
}) {
  return (
    <div className="gal-group" data-group={group}>
      {states.map((state) => (
        <Case key={state} label={state}>
          {render[state]}
        </Case>
      ))}
    </div>
  )
}

/**
 * One state of a section at a time, picked with chips, for a component that can be on a page only
 * once: its ids, or a radio group's name, would clash. Each state starts afresh.
 */
function OneAtATime<S extends string>({
  group,
  legend,
  states,
  render,
}: {
  group: string
  legend: string
  states: readonly S[]
  render: Record<S, ReactNode>
}) {
  const [shown, setShown] = useState(states[0])
  return (
    <div className="gal-group" data-group={group}>
      <fieldset className="gal-pick">
        <legend>{legend}</legend>
        {states.map((state) => (
          <label key={state} className="ab-chip">
            <input
              type="radio"
              name={`gal-${group}`}
              checked={shown === state}
              onChange={() => setShown(state)}
            />
            <span>{state}</span>
          </label>
        ))}
      </fieldset>
      <Case key={shown} label={shown}>
        {render[shown]}
      </Case>
    </div>
  )
}

/** Every state of each section, and of the intro and the pull machine. */
function SectionStates({ onOpen }: { onOpen: OpenTitle }) {
  const failed = statusText(STATUS_CASES.failed.status, false)
  const page: Record<State<'page'>, ReactNode> = {
    Loading: (
      <MangaPage
        id="gal-page-loading"
        heading="Trending now"
        sfx="ドン!"
        titles={[]}
        note="Loading…"
        loading
      />
    ),
    'Failed, with Try again': (
      <MangaPage
        id="gal-page-failed"
        heading="Trending now"
        sfx="ドン!"
        titles={[]}
        note={failed}
        onRetry={noop}
      />
    ),
    'Fan favorites, the samples': (
      <MangaPage
        id="gal-page-samples"
        heading="Fan favorites"
        sfx="ドン!"
        titles={FAVORITES}
        ranked={false}
        onOpen={onOpen}
        note={sampleNote(
          'These are fan favorites, not this week’s trending.',
          STATUS_CASES.retrying.status,
          false,
        )}
      />
    ),
    'Only 4 titles': (
      <MangaPage
        id="gal-page-four"
        heading="Trending now"
        sfx="ドン!"
        titles={FOUR}
        onOpen={onOpen}
      />
    ),
  }
  const strip: Record<State<'strip'>, ReactNode> = {
    'A row': (
      <Strip
        id="gal-strip-row"
        heading="Browse by decade"
        sfx="バーン"
        titles={ROW}
        onOpen={onOpen}
      />
    ),
    'A grid, as search results are': (
      <Strip
        id="gal-strip-grid"
        heading="Results for “ghibli”"
        sfx="サーチ!"
        titles={ROW}
        grid
        onOpen={onOpen}
      />
    ),
    Loading: (
      <Strip
        id="gal-strip-loading"
        heading="Browse by decade"
        sfx="バーン"
        titles={[]}
        note="Loading…"
        loading
      />
    ),
    'No titles found': (
      <Strip
        id="gal-strip-empty"
        heading="Results for “zzzz”"
        sfx="サーチ!"
        titles={[]}
        note="No titles found."
        grid
      />
    ),
  }
  const actions = [
    { href: '#gal-titles', label: 'See the title cases' },
    { href: '#gal-states', label: 'See the sections' },
  ]
  const intro: Record<State<'intro'>, ReactNode> = {
    '3 covers': <IntroHero titles={SAMPLES} actions={actions} />,
    'Covers with gaps': <IntroHero titles={GAPS} actions={actions} />,
    Loading: <IntroHero titles={[]} loading actions={actions} />,
    'No covers': <IntroHero titles={[]} actions={actions} />,
  }
  const pull: Record<State<'pull'>, ReactNode> = {
    'Nothing to pull yet': <PullMachine pool={[]} onOpen={onOpen} />,
    'Nothing it may hand out (all Ecchi)': <PullMachine pool={ECCHI_POOL} onOpen={onOpen} />,
    'The samples': <PullMachine pool={SAMPLES} onOpen={onOpen} />,
    'The title cases': <PullMachine pool={CASES} onOpen={onOpen} />,
  }
  return (
    <Part
      id="gal-states"
      heading="Section states"
      note="The intro and the pull machine can be on a page only once (their ids, and the machine’s vibe buttons), so they show one state at a time."
    >
      <Each group="page" states={STATES.page} render={page} />
      <Each group="strip" states={STATES.strip} render={strip} />
      <OneAtATime group="intro" legend="The intro" states={STATES.intro} render={intro} />
      <OneAtATime group="pull" legend="The pull machine" states={STATES.pull} render={pull} />
    </Part>
  )
}

/** Every line a section's status can read, and what the section and a search say with it. */
function StatusLines() {
  return (
    <Part
      id="gal-lines"
      heading="Status lines"
      note="Each list status, as statusText words it; then the note a section shows (none while its titles show and all is well); then what a screen reader hears of a search for “frieren”."
    >
      <dl className="gal-group gal-lines" data-group="lines">
        {Object.values(STATUS_CASES).map(({ label, status, rateLimited = false }) => (
          <div key={label} className="gal-case" data-case={label}>
            <dt>{label}</dt>
            <dd>{statusText(status, rateLimited)}</dd>
            <dd>
              <small>Section note:</small> {noteFor(status, rateLimited) ?? 'none'}
            </dd>
            <dd>
              <small>Search:</small> {searchStatus(status, 'frieren', rateLimited)}
            </dd>
          </div>
        ))}
      </dl>
    </Part>
  )
}

// Every cover color among the samples, then the ones deriveAccent has to correct: none, white,
// black, a gray, and one that isn't a color.
const COLORS = [
  ...new Set(SAMPLES.map((media) => media.coverImage.color)),
  null,
  '#ffffff',
  '#000000',
  '#808080',
  'red',
]
const ratio = (a: string, b: string) => `${contrast(a, b).toFixed(1)}:1`

/** Buttons, chips, Soon tags and each title color's accents. */
function Controls() {
  const [chip, setChip] = useState('1990s')
  return (
    <Part
      id="gal-controls"
      heading="Controls"
      note="Each swatch is a cover color’s accent fill under ink text, and its text color on the dotted page, with their contrast (at least 4.5:1)."
    >
      <div className="gal-group" data-group="controls">
        <Case label="Buttons">
          <div className="gal-row">
            <a className="ab-btn ab-btn-ink" href="#gal-controls">
              Primary
            </a>
            <a className="ab-btn" href="#gal-controls">
              Secondary
            </a>
            <button type="button" className="ab-btn ab-btn-hot">
              Save to My List
            </button>
            <RetryButton headingId="gal-controls" onRetry={noop} />
          </div>
        </Case>
        <Case label="Chips">
          <fieldset className="ab-eras">
            <legend className="sr-only">Decade</legend>
            {['1980s', '1990s', '2000s'].map((label) => (
              <label key={label} className="ab-chip">
                <input
                  type="radio"
                  name="gal-chips"
                  checked={chip === label}
                  onChange={() => setChip(label)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        </Case>
        <Case label="Soon tags">
          <div className="gal-row">
            <button type="button" className="ab-soon" disabled>
              Save to My List <small>Soon</small>
            </button>
            <span className="ab-soon" aria-disabled="true">
              My List <small>Soon</small>
            </span>
          </div>
        </Case>
        <Case label="Accent swatches">
          <ul className="gal-swatches">
            {COLORS.map((color) => {
              const { accent, text } = deriveAccent(color)
              return (
                <li key={String(color)} style={accentVars(color)}>
                  <span className="gal-fill">Aa {ratio(accent, INK)}</span>
                  <span className="gal-ink">Aa {ratio(text, DOTTED_PAPER)}</span>
                  <code>{String(color)}</code>
                </li>
              )
            })}
          </ul>
        </Case>
      </div>
    </Part>
  )
}

/** The mood sliders, on paper and on the machine's body, where Phase 5 puts them. */
function Sliders() {
  return (
    <Part
      id="gal-slider"
      heading="Mood sliders"
      note="The three mood axes, each a native range input from -2 to 2: on paper, then on the pull machine’s body, where Phase 5 puts them. Tab to one, then try the arrows, Home and End, or drag it."
    >
      <div className="gal-group" data-group="sliders">
        <Case label="On paper">
          <Axes />
        </Case>
        <Case label="On the machine">
          <div className="ab-body gal-machine">
            <Axes />
          </div>
        </Case>
      </div>
    </Part>
  )
}

/** A slider for each axis, starting at no preference. */
function Axes() {
  const [stops, setStops] = useState<Record<Axis, Stop>>({ energy: 0, tone: 0, complexity: 0 })
  return (
    <div className="gal-sliders">
      {(Object.keys(AXES) as Axis[]).map((axis) => (
        <MoodSlider
          key={axis}
          axis={axis}
          value={stops[axis]}
          onChange={(stop) => setStops({ ...stops, [axis]: stop })}
        />
      ))}
    </div>
  )
}
