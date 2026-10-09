import { useLayoutEffect, useRef } from 'react'

export type NavLink = { href: string; label: string; current?: boolean }

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
  onSearch: (text: string) => void
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
        {links.map((link) => (
          <a key={link.href} href={link.href} aria-current={link.current ? 'page' : undefined}>
            {link.label}
          </a>
        ))}
      </nav>
      <SearchBubble value={search} onChange={onSearch} />
    </header>
  )
}

// A manga speech bubble: snug around "Search titles" at rest, popping out to fit what's typed.
// A hidden copy of the text, in the same font, is watched for size changes (each keystroke, and
// the web font finishing loading); its width goes to CSS, which animates the bubble to match.
function SearchBubble({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const field = useRef<HTMLLabelElement>(null)
  const mirror = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const label = field.current
    const copy = mirror.current
    if (!label || !copy) return
    const observer = new ResizeObserver(() =>
      label.style.setProperty('--text-w', `${copy.offsetWidth}px`),
    )
    observer.observe(copy)
    return () => observer.disconnect()
  }, [])
  return (
    <label ref={field} className="ab-search">
      <span className="sr-only">Search titles</span>
      <span className="ab-bubble-field">
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search titles"
        />
      </span>
      <span ref={mirror} className="ab-search-mirror" aria-hidden="true">
        {value || 'Search titles'}
      </span>
    </label>
  )
}
