import { useState, type ReactNode } from 'react'
import { MangaPage, PANELS } from '../components/MangaPage.tsx'
import { MotionSwitch } from '../components/MotionSwitch.tsx'
import { SiteHeader } from '../components/SiteHeader.tsx'
import { Strip } from '../components/Strip.tsx'
import { mediaOf, TITLE_CASES } from './cases.ts'
import './gallery.css'

// Tailwind doesn't read this folder (see styles/index.css): the word capitalize here is a canary,
// which privacy.test.ts looks for in the production stylesheet.

// The title cases as titles.
const CASES = TITLE_CASES.map(mediaOf)

/**
 * AniBeam's components on one page, for judging the design without AniList: real sample titles,
 * forced edge cases (see cases.ts) and every state a section can be in. Development only, at
 * ?gallery (see main.tsx); it makes no request to AniList. Its root is .ab-app with <main
 * id="main">, as the app's, so the components look as they do there.
 */
export default function Gallery() {
  // The header's search box shows what is typed, and searches nothing.
  const [search, setSearch] = useState('')
  return (
    <div className="ab-app">
      <a className="ab-skip" href="#main">
        Skip to content
      </a>
      <SiteHeader
        links={[{ href: '#gal-titles', label: 'Titles' }]}
        search={search}
        onSearch={(shown) => setSearch(shown)}
      />
      <main id="main" className="gal">
        <header className="gal-head">
          <h1>AniBeam component gallery</h1>
          <p>
            Development only. Every component on real sample titles, with the gaps real AniList
            titles have, and every state a section can be in. Nothing here asks AniList for
            anything; the covers come from its image server.
          </p>
        </header>
        <TitleCases />
      </main>
      <footer className="ab-foot">
        <MotionSwitch id="reduce-motion" />
        <p>Data from AniList. AniBeam is not affiliated with AniList.</p>
      </footer>
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
      <h2 id={id} className="gal-title">
        {heading}
      </h2>
      <p className="gal-note">{note}</p>
      {children}
    </section>
  )
}

/** The title cases, each like a real AniList title, on a manga page and a strip. */
function TitleCases() {
  return (
    <Part
      id="gal-titles"
      heading="Title cases"
      note="Each case is a sample title with one gap forced, a gap a real AniList title has. Case n is panel n on the page and Ch.n on the strip."
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
      />
      <Strip id="gal-strip" heading="On a strip" sfx="バーン" titles={CASES} />
    </Part>
  )
}
