// Draft PR 3 (phase-2-proto-scroll, never merged): a prototype of the scroll slam, built twice,
// with the browser's own tools and with GSAP, so the two can be judged side by side by feel.
// `?motion=native` or `?motion=gsap` turns one on. The draft's Vercel preview is a production
// build, and React's development build would make either engine feel slower than it is, so the
// switch works in production builds too, everywhere but the live site.

export type SlamEngine = 'native' | 'gsap'

const LIVE = 'ani-beam.vercel.app'

/** The engine the address asks for: null when it asks for none, or an unknown one, or on the live site. */
export function slamEngine(search: string, hostname: string): SlamEngine | null {
  if (hostname === LIVE) return null
  const asked = new URLSearchParams(search).get('motion')
  return asked === 'native' || asked === 'gsap' ? asked : null
}
