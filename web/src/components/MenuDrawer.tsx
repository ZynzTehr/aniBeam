import { useEffect, type RefObject } from 'react'
import { isPlainClick } from './plainClick.ts'
import type { NavLink } from './SiteHeader.tsx'

/** Katakana beside each link, as a sound effect would sit: decoration, never read. */
const KANA: Record<string, string> = {
  '#ab-trending': 'トレンド',
  '#pull': 'ガチャ',
  '#decades': 'ネンダイ',
}

/**
 * A phone's menu of the page's section links: a manga panel that slides in from the left, opened
 * by the header's hamburger (SiteHeader), shut by its X, Escape, Back, a tap on the dimmed page, a
 * link, or the page widening to 900px. A modal dialog, so the page behind it can't be reached or
 * read while it is open, and a sibling of the header, never inside it: Safari drops a closing
 * dialog from the top layer when something it sits in moves.
 */
export function MenuDrawer({
  links,
  currentHref,
  dialogRef,
  onToggle,
}: {
  links: NavLink[]
  currentHref?: string | null
  dialogRef: RefObject<HTMLDialogElement | null>
  onToggle: (open: boolean) => void
}) {
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    // Widened to 900px or more, where the header shows its links and no hamburger, the menu
    // shuts, and focus goes to the logo, the hamburger being gone.
    const wide = matchMedia('(min-width: 900px)')
    const widened = () => {
      if (!wide.matches || !dialog.open) return
      dialog.close()
      document.querySelector<HTMLElement>('.ab-logo')?.focus({ preventScroll: true })
    }
    // Back (iOS's is a swipe from the screen's left edge), or the address going to a section,
    // moves the page under the menu: the menu shuts too.
    const wentBack = () => dialog.open && dialog.close()
    // Safari can scroll the page under the menu despite the page's overflow: hidden (WebKit
    // 240859). With nothing in the panel to scroll, one finger's move scrolls nothing at all.
    const pinned = (event: TouchEvent) => {
      if (event.touches.length === 1 && dialog.scrollHeight <= dialog.clientHeight)
        event.preventDefault()
    }
    wide.addEventListener('change', widened)
    addEventListener('popstate', wentBack)
    addEventListener('hashchange', wentBack)
    dialog.addEventListener('touchmove', pinned, { passive: false })
    return () => {
      wide.removeEventListener('change', widened)
      removeEventListener('popstate', wentBack)
      removeEventListener('hashchange', wentBack)
      dialog.removeEventListener('touchmove', pinned)
    }
  }, [dialogRef])
  return (
    <dialog
      ref={dialogRef}
      id="ab-menu"
      className="ab-drawer"
      aria-labelledby="ab-menu-title"
      onClose={() => onToggle(false)}
      // A tap on the dimmed page beside the panel (the backdrop counts as the dialog itself).
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        if (e.target === e.currentTarget && e.clientX > box.right) e.currentTarget.close()
      }}
    >
      <div className="ab-drawer-page">
        <h2 id="ab-menu-title" className="ab-drawer-title">
          Menu <span aria-hidden="true">メニュー</span>
        </h2>
        <button
          type="button"
          className="ab-close"
          aria-label="Close menu"
          onClick={() => dialogRef.current?.close()}
        >
          <span className="ab-x" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>
        <nav aria-label="Sections">
          {links.map((link) =>
            link.soon ? (
              <span key={link.href} className="ab-soon" aria-disabled="true">
                {link.label} <small>Soon</small>
              </span>
            ) : (
              <a
                key={link.href}
                href={link.href}
                aria-current={link.href === currentHref ? 'location' : undefined}
                // Shut first, inside the click: an open menu keeps the page inert, and the jump
                // couldn't focus the heading. The browser jumps once this returns, as for any
                // link, and lib/jumps.ts keeps a tap's jump from showing the heading's ring.
                onClick={(e) => isPlainClick(e) && dialogRef.current?.close()}
              >
                {link.label}
                <span aria-hidden="true">{KANA[link.href]}</span>
              </a>
            ),
          )}
        </nav>
      </div>
    </dialog>
  )
}
