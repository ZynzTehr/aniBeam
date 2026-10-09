import { contrast, toHex, toOklch, type Oklch } from '../../lib/color.ts'

/** Ink, the paper theme's outline and text color (the --ink token). */
export const INK = '#141414'
/** The page's darkest pixel: paper (#f6f1e6) under one of its 7% black screentone dots. */
export const DOTTED_PAPER = '#e5e0d6'
/** Brand "hot", for titles without a usable cover color. */
export const BRAND = '#ff2d55'

// Look limits in OKLCH, tuned by eye on real AniList colors. Contrast is measured, not assumed.
const MAX_CHROMA = 0.24 // nothing more saturated than brand hot (0.238); more looks neon on paper
const MIN_CHROMA = 0.12 // dull colors get up to twice their chroma, to at most this; grays stay gray
const MIN_FILL_L = 0.6 // darker fills look muddy inside ink outlines
const MAX_FILL_L = 0.85 // lighter fills fade into the paper

export type Accent = {
  /**
   * --anime-accent: fills, hard shadows, screentone and the title wipe. At least 4.5:1 against
   * ink, so ink outlines, ink text and ink labels all read on it.
   */
  accent: string
  /**
   * --anime-accent-text: text, icons, borders and slider fills in the title's color. At least
   * 4.5:1 against the dotted page, so also on paper and white; white labels read on it too.
   */
  text: string
}

/**
 * A title's accent colors from its cover color (AniList coverImage.color, "#rrggbb" or null).
 * Anything else falls back to the brand color. The hue is kept; lightness and chroma change.
 */
export function deriveAccent(color: string | null): Accent {
  const hex = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : BRAND
  const { l, c, h } = toOklch(hex)
  const chroma = Math.min(MAX_CHROMA, Math.max(c, Math.min(MIN_CHROMA, c * 2)))
  const fillL = Math.min(Math.max(l, MIN_FILL_L), MAX_FILL_L)
  return {
    accent: shift({ l: fillL, c: chroma, h }, 1, (x) => contrast(x, INK) >= 4.5),
    text: shift({ l, c: chroma, h }, 0, (x) => contrast(x, DOTTED_PAPER) >= 4.5),
  }
}

/**
 * The color as it is if it passes. Otherwise the smallest lightness change toward `goal`
 * (1 is white, 0 is black; both always pass) that does, found by binary search on the hex.
 */
function shift(color: Oklch, goal: 0 | 1, passes: (hex: string) => boolean) {
  const start = toHex(color)
  if (passes(start)) return start
  let fail = color.l
  let pass: number = goal
  for (let i = 0; i < 16; i++) {
    const mid = (fail + pass) / 2
    if (passes(toHex({ ...color, l: mid }))) pass = mid
    else fail = mid
  }
  return toHex({ ...color, l: pass })
}
