import { hasSmallCover } from '../features/anime/format.ts'
import type { Media } from '../features/anime/queries.ts'
import { accentVars } from '../features/theming/deriveAccent.ts'
import { cssVars } from './cssVars.ts'

export type IntroAction = { href: string; label: string; primary?: boolean }

/**
 * The first screen says what AniBeam is before anything else: a place for anime fans to keep
 * up with what's hot and new, and to talk about it. It fills the screen under the header
 * (the header publishes its height as --top-h), so the next section starts below the fold.
 */
export function IntroHero({ titles, actions }: { titles: Media[]; actions: IntroAction[] }) {
  // Three real covers say "anime" at a glance. Small covers are skipped so none look blurry.
  const covers = titles.filter((media) => !hasSmallCover(media)).slice(0, 3)
  return (
    <section className="ab-intro" aria-labelledby="ab-intro-title">
      <div className="ab-intro-art" aria-hidden="true">
        {covers.map((media, i) => (
          <img
            key={media.id}
            src={media.coverImage.extraLarge}
            alt=""
            style={{ ...accentVars(media.coverImage.color), ...cssVars({ '--i': i }) }}
          />
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
      <nav className="ab-intro-actions" aria-label="Ways to find a title">
        {actions.map((action) => (
          <a
            key={action.href}
            className={action.primary ? 'ab-btn ab-btn-ink' : 'ab-btn'}
            href={action.href}
          >
            {action.label}
          </a>
        ))}
      </nav>
    </section>
  )
}
