import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ClickEvent } from 'react'
import { confirmsWord, searchable } from '../lib/ime.ts'
import { keyboardAfter, keyboardAt, oneLine, oneLineCaret, rowsShown } from '../lib/searchBox.ts'
import { LIST_HREF } from '../lib/sectionNav.ts'
import {
  afterSwipe,
  EDGE,
  opens,
  opensFrom,
  pageMoved,
  rowScrolls,
  swipeStart,
  zoomed,
  type Swipe,
} from '../lib/swipe.ts'
import { MenuDrawer } from './MenuDrawer.tsx'
import { openMenu } from './openMenu.ts'

/**
 * A section link, or a link to another of the app's pages (My List's, /list). `soon` marks a
 * feature from a later phase: shown with a tag, not a link. `current` marks the link to the page on
 * screen (aria-current="page"): My List's on My List, and the development prototype's (VariantD).
 */
export type NavLink = { href: string; label: string; current?: boolean; soon?: boolean }

/**
 * The logo, the section links and the title search. Under 900px it is one row: a hamburger that
 * opens the menu of the section links (MenuDrawer), as a rightward swipe across the page does, the
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
  onGo,
}: {
  links: NavLink[]
  search: string
  /** Every change to the box: what it shows, and the part of it to search (see searchable). */
  onSearch: (shown: string, text: string) => void
  homeHref?: string
  /** The address of the section the visitor is in (#pull, say): its link is marked current. */
  currentHref?: string | null
  /**
   * A click on AniBeam, or on a link to another of the app's pages (My List): the app goes there
   * itself on a plain click (see App's go). Without it, the browser follows them, as any link.
   */
  onGo?: (event: ClickEvent<HTMLAnchorElement>) => void
}) {
  const header = useRef<HTMLElement>(null)
  const burger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDialogElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
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

  // Zoomed in, a finger's sideways drag on the header or the menu pans the page (see zoomed):
  // data-zoomed hands those drags back to the browser (components.css).
  useEffect(() => {
    const view = window.visualViewport
    const root = document.documentElement
    if (!view) return
    const zoom = () => root.toggleAttribute('data-zoomed', zoomed())
    zoom()
    view.addEventListener('resize', zoom)
    return () => {
      view.removeEventListener('resize', zoom)
      root.removeAttribute('data-zoomed')
    }
  }, [])

  // A clearly sideways swipe to the right anywhere on a phone's page opens the menu, but not from
  // the screen's left edge, the system's Back, nor where opensFrom says a drag is the page's own:
  // the search bubble, a dialog, the decade strip. Touch events, passive, on the document: they
  // go on as the browser scrolls, zooms or selects (pointer events stop with a pointercancel
  // where touch-action leaves the drag to the browser, as it does on the page), and iOS Safari
  // sends them too. So nothing the browser does with a finger changes.
  useEffect(() => {
    let swipe: Swipe | null = null
    // When a swipe last opened the menu: a click straight after it (on a link, say, where the
    // finger lifted) does nothing (see afterSwipe).
    let swiped = -Infinity
    const point = (e: TouchEvent, t: Touch) => ({
      pointerId: t.identifier,
      clientX: t.clientX,
      clientY: t.clientY,
      timeStamp: e.timeStamp,
      pointerType: 'touch',
    })
    // Only the swiping finger moves, lifts or cancels its swipe, as in the menu's drag.
    const mine = (e: TouchEvent) => [...e.changedTouches].find((t) => t.identifier === swipe?.id)
    // Text being selected, its handles dragged, say, is the browser's.
    const selecting = () => document.getSelection()?.isCollapsed === false
    const unpull = () => {
      swipe = null
      header.current?.style.removeProperty('--pull')
    }
    const start = (e: TouchEvent) => {
      // A second finger laid down starts no swipe (see move for what it does to the first's).
      if (e.touches.length > 1) return
      const t = e.changedTouches[0]
      const on = e.target instanceof Element ? e.target : (e.target as Node).parentElement
      const free =
        t.clientX >= EDGE &&
        !matchMedia('(min-width: 900px)').matches &&
        !selecting() &&
        opensFrom(on, (el) => rowScrolls(el, getComputedStyle(el).overflowX))
      swipe = free ? swipeStart(point(e, t)) : null
    }
    const move = (e: TouchEvent) => {
      const t = mine(e)
      if (!swipe || !t) return
      // With a second finger down, resting or not, a move is a pinch, the browser's zoom (two
      // fingers drawing apart, one of them still or both moving): the swipe ends. A second finger
      // that taps and lifts before the first moves on changes nothing.
      if (e.touches.length > 1) return unpull()
      // Sideways only while more than twice as far across as up or down, all the way: a page
      // scroll that drifts or hooks sideways never opens it (see pageMoved).
      const s = pageMoved(swipe, point(e, t))
      if (!s || selecting()) return unpull()
      swipe = s
      if (s.axis !== 'x') return
      // The hamburger's bars lean into the swipe (components.css).
      header.current?.style.setProperty('--pull', String(Math.min(Math.max(s.dx / 48, 0), 1)))
      if (!opens(s)) return
      unpull()
      swiped = e.timeStamp
      if (openMenu(menu.current, burger.current, false)) setMenuOpen(true)
    }
    const lifted = (e: TouchEvent) => mine(e) && unpull()
    // On the window, before any other listener, the menu's own among them.
    const click = (e: MouseEvent) => {
      if (!afterSwipe(swiped, e.timeStamp)) return
      e.preventDefault()
      e.stopPropagation()
    }
    const passive = { passive: true }
    document.addEventListener('touchstart', start, passive)
    document.addEventListener('touchmove', move, passive)
    document.addEventListener('touchend', lifted, passive)
    document.addEventListener('touchcancel', lifted, passive)
    addEventListener('click', click, true)
    return () => {
      document.removeEventListener('touchstart', start)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', lifted)
      document.removeEventListener('touchcancel', lifted)
      removeEventListener('click', click, true)
    }
  }, [])

  const open = (byKey: boolean) => {
    if (openMenu(menu.current, burger.current, byKey)) setMenuOpen(true)
  }

  return (
    <>
      <header ref={header} className="ab-top">
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
        <a className="ab-logo" href={homeHref} onClick={onGo}>
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
                onClick={link.href.startsWith('#') ? undefined : onGo}
              >
                {link.label}
              </a>
            ),
          )}
        </nav>
        <SearchBubble value={search} onChange={onSearch} />
      </header>
      {/* The menu's My List stays to come for now, with its Soon tag, until it is a link there too,
          with its own kana and closing the menu as it goes. */}
      <MenuDrawer
        links={links.map((link) => (link.href === LIST_HREF ? { ...link, soon: true } : link))}
        currentHref={currentHref}
        dialogRef={menu}
        onToggle={setMenuOpen}
      />
    </>
  )
}

const PLACEHOLDER = 'Search titles'

// A manga speech bubble: snug around "Search titles" at rest, popping out to fit what's typed.
// A hidden copy of the text, in the same font, is watched for size changes (each keystroke, and
// the web font finishing loading); its width goes to CSS, which animates the bubble to match.
// A second copy always holds the placeholder, the box's only visible label, so CSS can keep the
// bubble wide enough to show it, whatever is typed and however far a reader widens text spacing.
// Where the room beside the hamburger and the logo can't hold that bubble at rest (the narrowest
// phones, or wider text spacing), the box says only "Search", which fits, and the copy still
// measures "Search titles" for when there is room again; the box is still named "Search
// titles", by its label.
// A third copy wraps as the box does, for under 900px, where the bubble grows a row at a time
// while it has focus, hanging down over the page: the rows it shows go to CSS as --text-h, which
// animates the bubble's height, and the height of one as --row. The box is a textarea, as an
// input can't wrap; a textarea is read as a plain text box, so a search landmark around it says
// it is the search.
function SearchBubble({
  value,
  onChange,
}: {
  value: string
  onChange: (shown: string, text: string) => void
}) {
  const field = useRef<HTMLDivElement>(null)
  const mirror = useRef<HTMLSpanElement>(null)
  const placeholderMirror = useRef<HTMLSpanElement>(null)
  const rows = useRef<HTMLSpanElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const [whole, setWhole] = useState(true)
  const placeholder = whole ? PLACEHOLDER : 'Search'
  // What the box held when an input method began composing (see searchable), and whether it
  // still is.
  const before = useRef('')
  const composing = useRef(false)
  // Android's Back puts a touch keyboard away but leaves focus in the box, whose ring then holds
  // a phone's header on the screen, with the grown bubble hanging over the results. So the screen
  // the page shows growing back as the keyboard goes takes focus out, as the Search key does (see
  // keyboardAfter). Not while an input method is converting a word: that is the input method's.
  useEffect(() => {
    const view = window.visualViewport
    const typed = box.current
    if (!view || !typed) return
    const screen = () => ({ width: view.width * view.scale, height: view.height * view.scale })
    let keyboard = keyboardAt(screen())
    const focused = () => (keyboard = keyboardAt(screen()))
    const resized = () => {
      if (typed !== document.activeElement) return
      const next = keyboardAfter(keyboard, screen())
      keyboard = next
      if (next.away && !composing.current && matchMedia('(pointer: coarse)').matches) typed.blur()
    }
    typed.addEventListener('focus', focused)
    view.addEventListener('resize', resized)
    return () => {
      typed.removeEventListener('focus', focused)
      view.removeEventListener('resize', resized)
    }
  }, [])
  useLayoutEffect(() => {
    const label = field.current
    const copy = mirror.current
    const placeholderCopy = placeholderMirror.current
    const wrapped = rows.current
    const typed = box.current
    if (!label || !copy || !placeholderCopy || !wrapped || !typed) return
    // The bubble at rest is 52px wider than its text (components.css).
    const choose = () =>
      setWhole(label.getBoundingClientRect().width >= placeholderCopy.offsetWidth + 52)
    // At once, so the first frame drawn says the right one.
    choose()
    const observer = new ResizeObserver(() => {
      label.style.setProperty('--text-w', `${copy.offsetWidth}px`)
      label.style.setProperty('--placeholder-w', `${placeholderCopy.offsetWidth}px`)
      choose()
      // A row is 20px, or more where a reader widens text spacing.
      const row = parseFloat(getComputedStyle(wrapped).lineHeight)
      const shown = rowsShown(wrapped.offsetHeight, row)
      label.style.setProperty('--text-h', `${shown.height}px`)
      label.style.setProperty('--row', `${row}px`)
      // Only past three rows can the box scroll (components.css).
      label.toggleAttribute('data-over', shown.over)
      // From 900px, typing at the end of a long query, the caret stays in view as the box
      // narrows: the bubble's spring overshoots after a paste, and the browser, which scrolled
      // to the caret in the wider box, wouldn't scroll back until the next key.
      if (typed === document.activeElement && typed.selectionStart === typed.value.length)
        typed.scrollLeft = typed.scrollWidth
    })
    observer.observe(label)
    observer.observe(copy)
    observer.observe(placeholderCopy)
    observer.observe(wrapped)
    observer.observe(typed)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={field} className="ab-search" role="search">
      <span className="ab-bubble-field">
        {/* The box's label, and its frame, so a press anywhere in the bubble's padding focuses
            it. Clips the box to the bubble as the bubble grows a row, so the new row is
            uncovered as the outline reaches it. */}
        <label className="ab-bubble-clip">
          <span className="sr-only">Search titles</span>
          {/* The box shows every keystroke, even one an input method is still converting, so it
              never fights the input method. Only the search waits for the finished word. */}
          <textarea
            ref={box}
            rows={1}
            enterKeyHint="search"
            autoComplete="off"
            // A title in romaji is no word a phone's keyboard knows: it must not "correct" it.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            onKeyDown={(event) => {
              // A key an input method takes, Esc to undo a conversion or Enter to pick a word,
              // is the input method's.
              if (confirmsWord(event.nativeEvent)) return
              // Esc empties the box, as a search input's does.
              if (event.key === 'Escape' && value) {
                event.preventDefault()
                onChange('', '')
              }
              if (event.key !== 'Enter') return
              // No new line: the search is one line, wrapped to fit. On a touch screen, Enter
              // (the keyboard's Search key) puts the keyboard away, so the results show.
              event.preventDefault()
              if (matchMedia('(pointer: coarse)').matches) event.currentTarget.blur()
            }}
            // Folded back to one row as focus leaves (on a phone), it shows the first; from
            // 900px, a long query shows its start, as a search input's did.
            onBlur={(event) => (event.currentTarget.scrollTop = event.currentTarget.scrollLeft = 0)}
            onCompositionStart={(event) => {
              before.current = event.currentTarget.value
              composing.current = true
            }}
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
              composing.current = false
              const text = oneLine(event.currentTarget.value)
              onChange(text, text)
            }}
            placeholder={placeholder}
          />
        </label>
        {/* From 900px, the clear button the search input had (a textarea has none). Esc does the
            same from the keyboard, so, like the input's, it is no Tab stop; and a press on it
            keeps focus in the box. Beside the label, not in it, so its name isn't read as part
            of the box's. */}
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
        {PLACEHOLDER}
      </span>
    </div>
  )
}
