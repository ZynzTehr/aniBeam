import type { NavLink } from '../../components/SiteHeader.tsx'
import type { Options } from './switches.ts'

const MOOD: NavLink = { href: '/mood', label: 'Mood' }

/**
 * The header's links as A3 sets them, on Discover or on the Mood page. (a) keeps today's four; (b)
 * makes Pull the Mood page's link, "Mood"; (c) adds Mood as a fifth. Seen from /mood, Discover's
 * sections are links to /, and Mood's own link is marked as the page on screen.
 */
export function linksFor(a3: Options['a3'], on: 'discover' | 'mood'): NavLink[] {
  const mood = on === 'mood' ? { ...MOOD, current: true } : MOOD
  const section = (href: string, label: string) => ({
    href: on === 'mood' ? `/${href}` : href,
    label,
  })
  return [
    section('#ab-trending', 'Trending'),
    ...(a3 === 'header' ? [mood] : [section('#pull', 'Pull')]),
    section('#decades', 'Decades'),
    ...(a3 === 'fifth' ? [mood] : []),
    { href: '/list', label: 'My List' },
  ]
}
