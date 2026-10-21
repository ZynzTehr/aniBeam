import type { NavLink } from '../../components/SiteHeader.tsx'

/**
 * The header's links once My List is real (PR 3): no Soon, a link to /list. The section links keep
 * the app's own addresses, so the phone menu finds their kana.
 */
export const LINKS: NavLink[] = [
  { href: '#ab-trending', label: 'Trending' },
  { href: '#pull', label: 'Pull' },
  { href: '#decades', label: 'Decades' },
  { href: '/list', label: 'My List' },
]
