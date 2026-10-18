import type { Ref } from 'react'
import type { NavLink } from './SiteHeader.tsx'

/**
 * On a phone, the page's section links once the intro's buttons and the header have scrolled
 * away: a slim bar that slides in from the top as the visitor scrolls up, and out as they scroll
 * down (see lib/sectionNav.ts, which shows it and makes it reachable; inert until then). The link
 * to the section the visitor is in is marked, as in the header.
 */
export function SectionBar({
  links,
  currentHref,
  barRef,
}: {
  links: NavLink[]
  currentHref: string | null
  barRef: Ref<HTMLElement>
}) {
  return (
    <nav ref={barRef} className="ab-bar" aria-label="Jump to a section" inert>
      {links
        .filter((link) => !link.soon)
        .map((link) => (
          <a
            key={link.href}
            href={link.href}
            aria-current={link.href === currentHref ? 'location' : undefined}
          >
            {link.label}
          </a>
        ))}
    </nav>
  )
}
