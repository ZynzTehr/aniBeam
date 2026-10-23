import type { MouseEvent as ClickEvent, Ref } from 'react'
import type { Media } from '../features/anime/queries.ts'
import { accentVars } from '../features/theming/deriveAccent.ts'
import { markBroken, markLoaded } from './cover.ts'
import { coverFan } from './coverFan.ts'
import { cssVars } from './cssVars.ts'

/** An intro button: a section link, or a link to another of the app's pages (My List's, /list). */
export type IntroAction = { href: string; label: string }

/**
 * The first screen says what AniBeam is before anything else: a place for anime fans to keep
 * up with what's hot and new, and to talk about it. It fills the screen under the header
 * (the header publishes its height as --top-h), so the next section starts below the fold.
 */
export function IntroHero({
  titles,
  coversRef,
  loading = false,
  actions,
  actionsRef,
  onGo,
}: {
  titles: Media[]
  /** Gets the cover fan, so App can tell when it is on screen (see useSteadyList). */
  coversRef?: Ref<HTMLDivElement>
  /** Hold the covers' place while the first load runs (on phones, so the headline stays put). */
  loading?: boolean
  actions: IntroAction[]
  /** The intro's buttons, the page's section links while they are on the screen (sectionNav). */
  actionsRef?: Ref<HTMLElement>
  /**
   * A click on a link to another of the app's pages (My List): the app goes there itself on a
   * plain click (see App's go). Without it, the browser follows it, as any link.
   */
  onGo?: (event: ClickEvent<HTMLAnchorElement>) => void
}) {
  // The same pick App's hold uses (see coverFan).
  const covers = coverFan(titles)
  return (
    <section className="ab-intro" aria-labelledby="ab-intro-title">
      <div
        ref={coversRef}
        className={loading ? 'ab-intro-art is-loading' : 'ab-intro-art'}
        aria-hidden="true"
      >
        {covers.map((media, i) => (
          // The frame holds the cover's place in its title's color, as a trending panel does.
          <span
            key={media.id}
            className="ab-intro-cover"
            style={{ ...accentVars(media.coverImage.color), ...cssVars({ '--i': i }) }}
          >
            <img
              src={media.coverImage.extraLarge}
              alt=""
              onLoad={markLoaded}
              onError={markBroken}
            />
          </span>
        ))}
      </div>
      <p className="ab-intro-kicker">For anime fans · powered by AniList</p>
      <h1 id="ab-intro-title" className="ab-intro-title">
        <span>
          What&rsquo;s hot.
          <span className="ab-intro-sfx" aria-hidden="true">
            キラーン
          </span>
        </span>{' '}
        <span>What&rsquo;s new.</span> <span>Talk about it.</span>
      </h1>
      <p className="ab-intro-lede">
        See what&rsquo;s trending this week, pull a random pick for your mood, or dig through past
        decades. Coming soon: chat with other fans about the shows, movies and OVAs you love.
      </p>
      {/* "Sections": the page's section links, and My List's, as the header's "Site" has them. */}
      <nav ref={actionsRef} className="ab-intro-actions" aria-label="Sections">
        {actions.map((action) => (
          <a
            key={action.href}
            className="ab-btn"
            href={action.href}
            onClick={action.href.startsWith('#') ? undefined : onGo}
          >
            {action.label}
          </a>
        ))}
      </nav>
    </section>
  )
}
