import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { searchable } from '../lib/ime.ts'
import { afterSwipe, EDGE, opens, swipeMoved, swipeStart, type Swipe } from '../lib/swipe.ts'
import { MenuDrawer } from './MenuDrawer.tsx'
import { openMenu } from './openMenu.ts'

/**
 * A section link. `soon` marks a feature from a later phase: shown with a tag, not a link.
 * `current` marks the link to the page on screen (aria-current="page"); only the development
 * prototype (VariantD) sets it.
 */
export type NavLink = { href: string; label: string; current?: boolean; soon?: boolean }

/**
 * The logo, the section links and the title search. Under 900px it is one row: a hamburger that
 * opens the menu of the section links (MenuDrawer), as a rightward swipe across the row does, the
 * logo, and the search on the far side, hiding as the page scrolls down and coming back as it
 * scrolls up (lib/sectionNav.ts). It publishes its own height as --top-h on <html>, so the intro
 * can fill exactly the rest of the first screen, and so what its links jump to lands below it,
 * even when it takes a second row (see components.css).
 */
export function SiteHeader({
  links,
  search,
  onSearch,
  homeHref = '/',
  currentHref,
}: {
  links: NavLink[]
  search: string
  /** Every change to the box: what it shows, and the part of it to search (see searchable). */
  onSearch: (shown: string, text: string) => void
  homeHref?: string
  /** The address of the section the visitor is in (#pull, say): its link is marked current. */
  currentHref?: string | null
}) {
  const header = useRef<HTMLElement>(null)
  const burger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDialogElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // A rightward swipe across the header opens the menu: not from the screen's left edge, the
  // system's Back, and not on the search bubble, where a drag selects text.
  const swipe = useRef<Swipe | null>(null)
  // When a swipe last opened the menu: a click straight after it (on the logo, say, where the
  // finger lifted) does nothing (see afterSwipe).
  const swiped = useRef(-Infinity)
  useLayoutEffect(() => {
    const element = header.current
    if (!element) return
    const root = document.documentElement.style
    const publish = () => root.setProperty('--top-h', `${element.offsetHeight}px`)
    // At once, before the first paint: the observer's first report can come a frame late, and
    // that frame sized the intro by the CSS fallback, so on a phone the headline jumped.
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(element)
    return () => {
      observer.disconnect()
      root.removeProperty('--top-h')
    }
  }, [])

  const open = (byKey: boolean) => {
    if (openMenu(menu.current, burger.current, byKey)) setMenuOpen(true)
  }
  const unpull = (element: HTMLElement) => {
    swipe.current = null
    element.style.removeProperty('--pull')
  }

  return (
    <>
      <header
        ref={header}
        className="ab-top"
        onPointerDown={(e) => {
          const narrow = !matchMedia('(min-width: 900px)').matches
          const clear = !(e.target as Element).closest('.ab-bubble-field')
          swipe.current = narrow && clear && e.clientX >= EDGE ? swipeStart(e) : null
        }}
        onPointerMove={(e) => {
          // Sideways only if more than twice as far across as down: a page scroll that drifts
          // never opens it.
          const s = swipe.current && swipeMoved(swipe.current, e, 2)
          swipe.current = s?.axis === 'y' ? null : s
          if (s?.axis !== 'x') return
          // The hamburger's bars lean into the swipe (components.css).
          e.currentTarget.style.setProperty('--pull', String(Math.min(Math.max(s.dx / 48, 0), 1)))
          if (opens(s)) {
            unpull(e.currentTarget)
            swiped.current = e.timeStamp
            open(false)
          }
        }}
        onPointerUp={(e) => unpull(e.currentTarget)}
        onPointerCancel={(e) => unpull(e.currentTarget)}
        onClickCapture={(e) => {
          if (!afterSwipe(swiped.current, e.timeStamp)) return
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <button
          ref={burger}
          type="button"
          className="ab-burger"
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls="ab-menu"
          aria-haspopup="dialog"
          // A click a key fired (Enter, Space) has no pointer type.
          onClick={(e) => open((e.nativeEvent as PointerEvent).pointerType === '')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 6h18M6 12h15M3 18h18" />
          </svg>
        </button>
        <a className="ab-logo" href={homeHref}>
          <ruby>
            AniBeam<rt>アニビーム</rt>
          </ruby>
        </a>
        {/* "Site": it holds My List too, and shows beside the intro's "Sections". Under 900px it
            isn't drawn: the menu holds the links. */}
        <nav className="ab-nav" aria-label="Site">
          {links.map((link) =>
            link.soon ? (
              <span key={link.href} className="ab-soon" aria-disabled="true">
                {link.label} <small>Soon</small>
              </span>
            ) : (
              <a
                key={link.href}
                href={link.href}
                aria-current={
                  link.current ? 'page' : link.href === currentHref ? 'location' : undefined
                }
              >
                {link.label}
              </a>
            ),
          )}
        </nav>
        <SearchBubble value={search} onChange={onSearch} />
      </header>
      <MenuDrawer links={links} currentHref={currentHref} dialogRef={menu} onToggle={setMenuOpen} />
    </>
  )
}

const PLACEHOLDER = 'Search titles'
// On the narrowest phones, beside the hamburger and the logo, only "Search" fits whole. Followed
// live, as a phone turns. The box is still named "Search titles", by its label.
const NARROW = '(max-width: 359px)'
const watchNarrow = (onChange: () => void) => {
  const list = matchMedia(NARROW)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}
const usePlaceholder = () =>
  useSyncExternalStore(watchNarrow, () => (matchMedia(NARROW).matches ? 'Search' : PLACEHOLDER))

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
  const placeholder = usePlaceholder()
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
          placeholder={placeholder}
        />
      </span>
      <span ref={mirror} className="ab-search-mirror" aria-hidden="true">
        {value || placeholder}
      </span>
      <span ref={placeholderMirror} className="ab-search-mirror" aria-hidden="true">
        {placeholder}
      </span>
    </label>
  )
}
