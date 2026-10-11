import { useLayoutEffect, useRef } from 'react'
import { searchable } from '../lib/ime.ts'

/** A section link. `soon` marks a feature from a later phase: shown with a tag, not a link. */
export type NavLink = { href: string; label: string; current?: boolean; soon?: boolean }

/**
 * The logo, the section links and the title search. It publishes its own height as --top-h
 * on <html>, so the intro can fill exactly the rest of the first screen (one row on desktop,
 * three on phones).
 */
export function SiteHeader({
  links,
  search,
  onSearch,
  homeHref = '/',
}: {
  links: NavLink[]
  search: string
  /** Every change to the box: what it shows, and the part of it to search (see searchable). */
  onSearch: (shown: string, text: string) => void
  homeHref?: string
}) {
  const header = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const element = header.current
    if (!element) return
    const root = document.documentElement.style
    const observer = new ResizeObserver(() =>
      root.setProperty('--top-h', `${element.offsetHeight}px`),
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      root.removeProperty('--top-h')
    }
  }, [])

  return (
    <header ref={header} className="ab-top">
      <a className="ab-logo" href={homeHref}>
        <ruby>
          AniBeam<rt>アニビーム</rt>
        </ruby>
      </a>
      <nav className="ab-nav" aria-label="Sections">
        {links.map((link) =>
          link.soon ? (
            <span key={link.href} className="ab-soon" aria-disabled="true">
              {link.label} <small>Soon</small>
            </span>
          ) : (
            <a key={link.href} href={link.href} aria-current={link.current ? 'page' : undefined}>
              {link.label}
            </a>
          ),
        )}
      </nav>
      <SearchBubble value={search} onChange={onSearch} />
    </header>
  )
}

const PLACEHOLDER = 'Search titles'

// A manga speech bubble: snug around "Search titles" at rest, popping out to fit what's typed.
// A hidden copy of the text, in the same font, is watched for size changes (each keystroke, and
// the web font finishing loading); its width goes to CSS, which animates the bubble to match.
// A second copy always holds the placeholder, the box's only visible label, so CSS can keep the
// bubble wide enough to show it, whatever is typed and however far a reader widens text spacing.
function SearchBubble({
  value,
  onChange,
}: {
  value: string
  onChange: (shown: string, text: string) => void
}) {
  const field = useRef<HTMLLabelElement>(null)
  const mirror = useRef<HTMLSpanElement>(null)
  const placeholderMirror = useRef<HTMLSpanElement>(null)
  // What the box held when an input method began composing (see searchable).
  const before = useRef('')
  useLayoutEffect(() => {
    const label = field.current
    const copy = mirror.current
    const placeholderCopy = placeholderMirror.current
    if (!label || !copy || !placeholderCopy) return
    const observer = new ResizeObserver(() => {
      label.style.setProperty('--text-w', `${copy.offsetWidth}px`)
      label.style.setProperty('--placeholder-w', `${placeholderCopy.offsetWidth}px`)
    })
    observer.observe(copy)
    observer.observe(placeholderCopy)
    return () => observer.disconnect()
  }, [])
  return (
    <label ref={field} className="ab-search">
      <span className="sr-only">Search titles</span>
      <span className="ab-bubble-field">
        {/* The box shows every keystroke, even one an input method is still converting, so it
            never fights the input method. Only the search waits for the finished word. */}
        <input
          type="search"
          value={value}
          onCompositionStart={(event) => (before.current = event.currentTarget.value)}
          onChange={(event) =>
            onChange(
              event.target.value,
              searchable(
                event.target.value,
                (event.nativeEvent as InputEvent).isComposing,
                before.current,
              ),
            )
          }
          // Chrome sends the finished word just before this, still marked as composing; Safari
          // sends it just after.
          onCompositionEnd={(event) =>
            onChange(event.currentTarget.value, event.currentTarget.value)
          }
          placeholder={PLACEHOLDER}
        />
      </span>
      <span ref={mirror} className="ab-search-mirror" aria-hidden="true">
        {value || PLACEHOLDER}
      </span>
      <span ref={placeholderMirror} className="ab-search-mirror" aria-hidden="true">
        {PLACEHOLDER}
      </span>
    </label>
  )
}
