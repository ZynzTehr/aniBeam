import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { confirmsWord, searchable } from '../lib/ime.ts'
import { oneLine, oneLineCaret, rowsShown } from '../lib/searchBox.ts'
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
 * logo, and the search on the far side, whose bubble grows down over the page a row at a time as
 * what is typed wraps, leaving the header its one row; the header hides as the page scrolls down
 * and comes back as it scrolls up (lib/sectionNav.ts). It publishes its own height as --top-h on
 * <html>, so the intro can fill exactly the rest of the first screen, and so what its links jump
 * to lands below it, even when it takes a second row from 900px (see components.css).
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
        {/* "Site": it holds My List too, as the intro's "Sections" does, and shows in their place
            once the intro's buttons have docked. Under 900px it isn't drawn: the menu holds the
            links. */}
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
// A third copy wraps as the box does, for under 900px, where the bubble grows a row at a time
// while it has focus, hanging down over the page: the rows it shows go to CSS as --text-h, which
// animates the bubble's height, and the height of one as --row. The box is a textarea, as an
// input can't wrap.
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
  const rows = useRef<HTMLSpanElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const placeholder = usePlaceholder()
  // What the box held when an input method began composing (see searchable).
  const before = useRef('')
  useLayoutEffect(() => {
    const label = field.current
    const copy = mirror.current
    const placeholderCopy = placeholderMirror.current
    const wrapped = rows.current
    if (!label || !copy || !placeholderCopy || !wrapped) return
    const observer = new ResizeObserver(() => {
      label.style.setProperty('--text-w', `${copy.offsetWidth}px`)
      label.style.setProperty('--placeholder-w', `${placeholderCopy.offsetWidth}px`)
      // A row is 20px, or more where a reader widens text spacing.
      const row = parseFloat(getComputedStyle(wrapped).lineHeight)
      const shown = rowsShown(wrapped.offsetHeight, row)
      label.style.setProperty('--text-h', `${shown.height}px`)
      label.style.setProperty('--row', `${row}px`)
      // Only past three rows can the box scroll (components.css).
      label.toggleAttribute('data-over', shown.over)
    })
    observer.observe(copy)
    observer.observe(placeholderCopy)
    observer.observe(wrapped)
    return () => observer.disconnect()
  }, [])
  return (
    <label ref={field} className="ab-search">
      <span className="sr-only">Search titles</span>
      <span className="ab-bubble-field">
        {/* Clips the box to the bubble as the bubble grows a row, so the new row is uncovered as
            the outline reaches it. */}
        <span className="ab-bubble-clip">
          {/* The box shows every keystroke, even one an input method is still converting, so it
              never fights the input method. Only the search waits for the finished word. */}
          <textarea
            ref={box}
            rows={1}
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onKeyDown={(event) => {
              // Esc empties the box, as a search input's does.
              if (event.key === 'Escape' && value) {
                event.preventDefault()
                onChange('', '')
              }
              if (event.key !== 'Enter' || confirmsWord(event.nativeEvent)) return
              // No new line: the search is one line, wrapped to fit. On a touch screen, Enter
              // (the keyboard's Search key) puts the keyboard away, so the results show.
              event.preventDefault()
              if (matchMedia('(pointer: coarse)').matches) event.currentTarget.blur()
            }}
            // Folded back to one row as focus leaves (on a phone), it shows the first.
            onBlur={(event) => (event.currentTarget.scrollTop = 0)}
            onCompositionStart={(event) => (before.current = event.currentTarget.value)}
            onChange={(event) => {
              const box = event.target
              const text = oneLine(box.value)
              // A pasted line break becomes a space here, in the box itself, before React would
              // put the shorter text back and the caret at the end, away from the paste.
              if (text !== box.value) {
                const caret = oneLineCaret(box.value, box.selectionEnd)
                box.value = text
                box.setSelectionRange(caret, caret)
              }
              // As the box takes a new row the browser scrolls the row into view before the box
              // has grown: back to the top, so the text holds still as the bubble grows. Past
              // three rows, typing at the end, the last three show whole. In whole rows: the box
              // keeps a pixel below its last.
              const row = parseFloat(getComputedStyle(box).lineHeight)
              if (!rowsShown(Math.floor(box.scrollHeight / row) * row, row).over) box.scrollTop = 0
              else if (box.selectionEnd === box.value.length) box.scrollTop = box.scrollHeight
              onChange(
                text,
                searchable(text, (event.nativeEvent as InputEvent).isComposing, before.current),
              )
            }}
            // Chrome sends the finished word just before this, still marked as composing; Safari
            // sends it just after.
            onCompositionEnd={(event) => {
              const text = oneLine(event.currentTarget.value)
              onChange(text, text)
            }}
            placeholder={placeholder}
          />
        </span>
        {/* From 900px, the clear button the search input had (a textarea has none). Esc does the
            same from the keyboard, so, like the input's, it is no Tab stop; and a press on it
            keeps focus in the box. */}
        {value && (
          <button
            type="button"
            className="ab-clear"
            aria-label="Clear search"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('', '')
              box.current?.focus()
            }}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        )}
        <span ref={rows} className="ab-search-rows" aria-hidden="true">
          {value || placeholder}
        </span>
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
