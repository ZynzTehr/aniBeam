import { useState } from 'react'
import { MotionSwitch } from '../components/MotionSwitch.tsx'
import { SiteHeader } from '../components/SiteHeader.tsx'
import './gallery.css'

// Tailwind doesn't read this folder (see styles/index.css): the word capitalize here is a canary,
// which privacy.test.ts looks for in the production stylesheet.

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
      <SiteHeader links={[]} search={search} onSearch={(shown) => setSearch(shown)} />
      <main id="main" className="gal">
        <header className="gal-head">
          <h1>AniBeam component gallery</h1>
          <p>
            Development only. Every component on real sample titles, with the gaps real AniList
            titles have, and every state a section can be in. Nothing here asks AniList for
            anything; the covers come from its image server.
          </p>
        </header>
      </main>
      <footer className="ab-foot">
        <MotionSwitch id="reduce-motion" />
        <p>Data from AniList. AniBeam is not affiliated with AniList.</p>
      </footer>
    </div>
  )
}
