// Color math for the accent tokens. Colors are #rrggbb strings. Contrast follows WCAG 2.x;
// OKLCH (Björn Ottosson's OKLab, in polar form) lets lightness change while hue stays put.

type Rgb = [number, number, number]
export type Oklch = { l: number; c: number; h: number }

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb

// The sRGB transfer function and its inverse (IEC 61966-2-1).
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toGamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

/** WCAG 2.x relative luminance: 0 for black, 1 for white. */
export function luminance(hex: string) {
  const [r, g, b] = channels(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.x contrast ratio, from 1 to 21. The order of the two colors doesn't matter. */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** #rrggbb to OKLCH: lightness l from 0 to 1, chroma c from 0 (gray) up, hue h in degrees. */
export function toOklch(hex: string): Oklch {
  const [r, g, b] = channels(hex).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  // The published matrix is rounded, so grays come out with a chroma near 4e-8 instead of 0.
  // Any real 8-bit color has far more (at least about 1e-3), so this only clears the noise.
  const c = Math.hypot(A, B)
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: c < 1e-6 ? 0 : c,
    h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
  }
}

// OKLCH to linear sRGB. A channel outside 0..1 means the color is outside the sRGB gamut.
function linearRgb({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos((h * Math.PI) / 180)
  const B = c * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const fits = (rgb: Rgb) => rgb.every((v) => v >= 0 && v <= 1)

/**
 * OKLCH to #rrggbb. A color outside sRGB gives up chroma (found by binary search) until it fits,
 * so its lightness and hue stay put; clipping the channels instead would shift the hue.
 */
export function toHex(color: Oklch): string {
  let rgb = linearRgb(color)
  if (!fits(rgb)) {
    let [lo, hi] = [0, color.c]
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2
      if (fits(linearRgb({ ...color, c: mid }))) lo = mid
      else hi = mid
    }
    rgb = linearRgb({ ...color, c: lo })
  }
  // The clamp only removes floating-point noise: the color is inside the gamut by now.
  const byte = (v: number) => Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255)
  return '#' + rgb.map((v) => byte(v).toString(16).padStart(2, '0')).join('')
}
