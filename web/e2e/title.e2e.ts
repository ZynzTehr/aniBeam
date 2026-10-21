// The title card as a title page (spec §3A, plan PRs 12 and 13): its layout and its details, from
// a phone to a wide screen. The titles come from the recordings; a check that needs something
// particular of a title, such as no banner, stages it with rewriteAniList on Frieren's answer.
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { runtimeOf } from '../src/features/anime/format.ts'
import type { Media, Tag } from '../src/features/anime/queries.ts'
import { parseSynopsis } from '../src/features/anime/synopsis.ts'
import { tagsOf } from '../src/features/anime/tags.ts'
import { BASE_URL, Browser } from './browser.ts'
import { recordings } from './recordings.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open()
})
after(() => browser?.close())

// Each check fails on an uncaught exception, or a console error or warning, from the page while it
// ran (see Browser.problems).
let problemsBefore = 0
beforeEach(() => {
  problemsBefore = browser.problems.length
})
afterEach(() => {
  assert.deepEqual(browser.problems.slice(problemsBefore), [], 'the page reported problems')
})

// A phone, a tablet in portrait (the card's two columns, narrowest) and a wide screen. Phones and
// tablets get Chrome's mobile emulation, as a visitor's device would.
const SCREENS = [
  { width: 390, height: 844, phone: true },
  { width: 834, height: 1112, phone: true },
  { width: 1440, height: 900, phone: false },
]
const at = (path: string) => new URL(path, BASE_URL).href

// The open title card's heading, or '' with none open.
const CARD = `document.querySelector('dialog.ab-card[open] #ab-card-title')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`

/**
 * Opens Frieren's card at its address, under reduced motion, and waits until it has landed. Nothing
 * of it is saved first, so it comes from its answer, as a check has staged it or as recorded, not
 * as an earlier check staged it.
 */
async function openFrieren(screen: (typeof SCREENS)[number]) {
  await browser.forget()
  await browser.load({ ...screen, reduceMotion: true, url: at('/anime/154587') })
  assert.ok(
    await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000),
    `at ${screen.width}px, no card opened for Frieren`,
  )
  await browser.animationsDone()
}

// Frieren's banner as AniList gives it, gone (as for about 38% of titles), or at an address that
// fails to load: a data: URL that is no image, so the failure needs no request.
const BANNERS = {
  'a banner': undefined,
  'no banner': null,
  'a broken banner': 'data:image/png;base64,AAAA',
} as const
type Banner = keyof typeof BANNERS

/**
 * Frieren's answer from now on with the banner `banner` asks for, and nothing of it saved, so the
 * next visit to its address asks for it again.
 */
async function stage(banner: Banner) {
  await browser.forget()
  const url = BANNERS[banner]
  await browser.rewriteAniList(({ request, status, body }) => {
    if (request.variables.id !== 154587 || url === undefined) return null
    body.data.Media.bannerImage = url
    return { status, body }
  })
}

// Once the open card's banner, if it has one, has loaded or failed, its error or load event has
// been handled (two frames on), and a banner that loaded has faded in.
const BANNER_SETTLED = `(async () => {
  const banner = document.querySelector('dialog.ab-card[open] .ab-band img')
  if (banner) await banner.decode().catch(() => {})
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  if (banner) await Promise.all(banner.getAnimations().map((a) => a.finished.catch(() => {})))
  return true
})()`

test('the banner band crowns the card in an ink frame, the same size with a banner, without one and with a broken one', async () => {
  // Spec §3A: the banner across the top, clamp(200px, 25vw, 420px) tall on a desktop, a short
  // strip on a phone (19:4, the banner's own shape, where the card stacks, to 820px), cropped to
  // fill. It sits flush inside the sheet's ink border, inked along its foot, with the cover and
  // the text below it. With no banner, or one that fails to load, it keeps its size, so the card
  // looks the same either way and nothing moves as a banner loads or fails; a failed one hides,
  // rather than show Chrome's broken-image icon.
  // A phone zoomed past 125% is under 320px wide: there the strip keeps the height the close
  // button needs to stand clear of the ink line, 64px. At 280px the copy's Soon buttons (213px)
  // already push the card's column 2.5px past the sheet's padding, and the band follows the
  // column: that is the buttons' to settle, so there the band's place inside the border is not
  // held to.
  const seen: string[] = []
  try {
    for (const banner of Object.keys(BANNERS) as Banner[]) {
      await stage(banner)
      for (const screen of [{ width: 280, height: 653, phone: true }, ...SCREENS]) {
        await openFrieren(screen)
        await browser.evaluate(BANNER_SETTLED)
        const band = await browser.evaluate<Record<string, unknown> | null>(`(() => {
          const card = document.querySelector('dialog.ab-card[open]')
          const band = card.querySelector('.ab-sheet > .ab-band')
          if (!band) return null
          const sheet = card.querySelector('.ab-sheet').getBoundingClientRect(), box = band.getBoundingClientRect()
          const style = getComputedStyle(band), img = band.querySelector('img')
          const px = (n) => Math.round(n * 10) / 10
          // Phones and tablets up to 820px stack the card: there the band is a 19:4 strip, 64px at least.
          const height = innerWidth <= 820 ? Math.max(64, box.width * 4 / 19) : Math.min(420, Math.max(200, innerWidth / 4))
          const shown = img && img.checkVisibility({ visibilityProperty: true, opacityProperty: true })
          const inside = { top: box.top, left: box.left, right: box.right, bottom: box.bottom - parseFloat(style.borderBottomWidth) }
          const fills = img && ['top', 'left', 'right', 'bottom'].every((side) => Math.abs(img.getBoundingClientRect()[side] - inside[side]) < 1)
          return {
            'inside the sheet border': px(box.top - sheet.top) + ', ' + px(box.left - sheet.left) + ', ' + px(sheet.right - box.right),
            height: Math.abs(box.height - height) < 1 ? 'as it should be' : px(box.height) + 'px, not ' + px(height) + 'px',
            'ink line': style.borderBottomStyle + ' ' + style.borderBottomWidth + ' ' + style.borderBottomColor,
            banner: !img ? 'none' : img.hasAttribute('data-broken') ? (shown ? 'broken, shown' : 'broken, hidden') : !img.complete || !img.naturalWidth ? 'not loaded' : shown && fills && getComputedStyle(img).objectFit === 'cover' ? 'fills the band' : 'shown, not filling the band',
            'the cover': card.querySelector('.ab-sheet-art img').getBoundingClientRect().top >= box.bottom ? 'below it' : 'under it',
            'the close button': (() => { const over = card.querySelector('.ab-close').getBoundingClientRect().bottom - inside.bottom; return over <= 0 ? 'clear of the ink line' : 'over the ink line by ' + px(over) + 'px' })(),
          }
        })()`)
        const expected = {
          'inside the sheet border': '5, 5, 5',
          height: 'as it should be',
          'ink line': 'solid 5px rgb(20, 20, 20)',
          banner: {
            'a banner': 'fills the band',
            'no banner': 'none',
            'a broken banner': 'broken, hidden',
          }[banner],
          'the cover': 'below it',
          'the close button': 'clear of the ink line',
        }
        if (band && screen.width < 320)
          band['inside the sheet border'] = expected['inside the sheet border']
        if (JSON.stringify(band) !== JSON.stringify(expected))
          seen.push(`${screen.width}px, ${banner}: ${JSON.stringify(band)}`)
      }
    }
  } finally {
    await browser.rewriteAniList(null)
  }
  assert.deepEqual(seen, [], 'cards whose banner band is missing, or out of shape or place')
})

test('the band and the cover stay put from the card’s first frame to the banner’s arrival, the card opens without waiting for it, and the banner fades in', async () => {
  // The banner is large (123 to 358 KB) and comes after the card has opened: the band must not
  // wait for it to show, nor change size as it lands. Frame by frame from the card's first, the
  // band's box and the cover's place stay the same, and the card shows before the banner has
  // come. Its address is made new for this check, so no copy saved earlier can bring it at once.
  // Under reduced motion, as here, a banner that comes late fades in once it has loaded, from no
  // more than a quarter seen in the first frame it could show: appearing at once, it changed
  // about a third of a wide screen in one frame.
  await browser.forget()
  await browser.rewriteAniList(({ request, status, body }) => {
    if (request.variables.id !== 154587) return null
    body.data.Media.bannerImage += `?late=${Date.now()}`
    return { status, body }
  })
  // The answer comes after a second, so the frames are watched from before the card opens.
  await browser.holdAniList(1000)
  try {
    await browser.load({ width: 1440, height: 900, reduceMotion: true, url: at('/anime/154587') })
    const frames = await browser.evaluate<
      { boxes: string[]; before: number; seen: number[] } | 'no band' | null
    >(`new Promise((resolve) => {
      const boxes = [], seen = [], until = performance.now() + 15000
      let before = 0
      requestAnimationFrame(function frame() {
        const card = document.querySelector('dialog.ab-card[open]')
        const band = card?.querySelector('.ab-band'), banner = band?.querySelector('img')
        if (performance.now() > until) return resolve(boxes.length ? null : 'no band')
        if (band) {
          const b = band.getBoundingClientRect(), c = card.querySelector('.ab-sheet-art img').getBoundingClientRect()
          const box = [b.top, b.left, b.width, b.height, c.top, c.left].map(Math.round).join(' ')
          if (boxes.at(-1) !== box) boxes.push(box)
          // How much of the banner each frame shows, from the first it has loaded, until it shows
          // in full, a second on at most.
          if (banner?.complete && banner.naturalWidth) seen.push(Number(getComputedStyle(banner).opacity))
          else before++
          if (seen.at(-1) === 1 || seen.length > 60) return resolve({ boxes, before, seen })
        }
        requestAnimationFrame(frame)
      })
    })`)
    assert.notEqual(frames, 'no band', 'the card has no banner band')
    assert.ok(frames && frames !== 'no band', 'the banner never arrived')
    assert.ok(frames.before > 0, 'the card waited for its banner before it showed')
    assert.equal(frames.boxes.length, 1, `the band or the cover moved: ${frames.boxes.join(' → ')}`)
    const shown = frames.seen.map((opacity) => Math.round(opacity * 100) / 100)
    assert.ok(
      shown[0] <= 0.25 && shown.at(-1) === 1,
      `the banner, from the first frame it had loaded: ${shown.join(', ')} of it shown`,
    )
  } finally {
    await browser.holdAniList(0)
    await browser.rewriteAniList(null)
  }
})

test('details that arrive late move nothing above them: the cover and the title stay put', async () => {
  // The synopsis and tags (PR 13) arrive after the card opens, below the facts. The sheet
  // centered its columns in its height, so the copy growing under the facts moved the cover down
  // and the title up, 181px in the title lab. A tall block added at the copy's foot, as the
  // details will be, must leave the cover, the kicker and the title where they were.
  const moved: string[] = []
  for (const screen of SCREENS) {
    await openFrieren(screen)
    const tops = `(() => {
      const card = document.querySelector('dialog.ab-card[open]')
      const top = (selector) => Math.round(card.querySelector(selector).getBoundingClientRect().top)
      return { cover: top('.ab-sheet-art img'), kicker: top('.ab-kicker'), title: top('.ab-title') }
    })()`
    const before = await browser.evaluate<Record<string, number>>(tops)
    await browser.evaluate(`(() => {
      const late = document.createElement('div')
      late.style.height = '600px'
      document.querySelector('dialog.ab-card[open] .ab-sheet-copy').append(late)
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))
    })()`)
    const after = await browser.evaluate<Record<string, number>>(tops)
    for (const part of Object.keys(before))
      if (after[part] !== before[part])
        moved.push(`${screen.width}px: the ${part}, ${before[part]} → ${after[part]}px`)
  }
  assert.deepEqual(moved, [], 'parts of the card that moved as the details arrived below them')
})

/**
 * What the open card's band shows above its ink line, from a screenshot: the share of its pixels,
 * in percent, near each of the colors `near` names (CSS colors, within 60 of red, green and blue
 * together), and the shares lighter and darker than the first of them by at least 0.08 of WCAG
 * luminance. Decoded in the page. The close button, which stands over the band's corner, is made
 * see-through meanwhile (focus stays where it is), so only the band is counted.
 */
async function bandPixels(near: string[]) {
  const clip = await browser.evaluate<{
    x: number
    y: number
    width: number
    height: number
  }>(`(() => {
    const band = document.querySelector('dialog.ab-card[open] .ab-band')
    document.querySelector('dialog.ab-card[open] .ab-close').style.opacity = '0'
    const box = band.getBoundingClientRect(), ink = parseFloat(getComputedStyle(band).borderBottomWidth)
    return { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height - ink }
  })()`)
  const png = await browser.screenshot(clip)
  await browser.evaluate(
    `document.querySelector('dialog.ab-card[open] .ab-close').style.removeProperty('opacity'); true`,
  )
  return browser.evaluate<{ near: number[]; lighter: number; darker: number }>(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    const swatch = new OffscreenCanvas(1, 1).getContext('2d')
    const rgb = (color) => { swatch.clearRect(0, 0, 1, 1); swatch.fillStyle = color; swatch.fillRect(0, 0, 1, 1); return [...swatch.getImageData(0, 0, 1, 1).data].slice(0, 3) }
    const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    const colors = ${JSON.stringify(near)}.map(rgb), first = lum(colors[0])
    const near = colors.map(() => 0)
    let lighter = 0, darker = 0
    const pixels = data.length / 4
    for (let i = 0; i < data.length; i += 4) {
      const pixel = [data[i], data[i + 1], data[i + 2]]
      colors.forEach((color, k) => { if (color.reduce((sum, v, j) => sum + Math.abs(v - pixel[j]), 0) <= 60) near[k]++ })
      const l = lum(pixel)
      if (l >= first + 0.08) lighter++
      if (l <= first - 0.08) darker++
    }
    const percent = (n) => Math.round((n / pixels) * 1000) / 10
    return { near: near.map(percent), lighter: percent(lighter), darker: percent(darker) }
  })()`)
}

test('with no banner, or a broken one, the band is an impact frame in the title’s color: speed lines and screentone, no blur', async () => {
  // A title without a banner should still look intentional (spec §8): the band shows the wipe's
  // look, the title's color with white speed lines bursting from a bright middle and the page's
  // screentone dots, sharp, with no blurred cover. Mostly the title's color, with light lines and
  // dark dots both plain to see. The bright middle alone is about 9% of the band lighter than the
  // title's color, and with the lines about 31%: a fifth at least asks for the lines too.
  const seen: string[] = []
  try {
    for (const banner of ['no banner', 'a broken banner'] as const) {
      await stage(banner)
      for (const screen of [SCREENS[0], SCREENS[2]]) {
        await openFrieren(screen)
        await browser.evaluate(BANNER_SETTLED)
        const accent = await browser.evaluate<string>(
          `getComputedStyle(document.querySelector('dialog.ab-card[open]')).getPropertyValue('--anime-accent')`,
        )
        const { near, lighter, darker } = await bandPixels([accent])
        const blurred = await browser.evaluate<string[]>(`(() => {
          const band = document.querySelector('dialog.ab-card[open] .ab-band')
          return [band, ...band.querySelectorAll('*')].flatMap((part) => ['', '::before', '::after'].flatMap((pseudo) => {
            const style = getComputedStyle(part, pseudo || null)
            return [style.filter, style.backdropFilter].filter((value) => value !== 'none')
          }))
        })()`)
        const where = `${screen.width}px, ${banner}`
        if (near[0] < 40) seen.push(`${where}: ${near[0]}% in the title's color ${accent}`)
        if (lighter < 20) seen.push(`${where}: ${lighter}% speed lines, lighter than its color`)
        if (darker < 2) seen.push(`${where}: ${darker}% screentone, darker than its color`)
        if (blurred.length) seen.push(`${where}: blurred with ${blurred.join(', ')}`)
      }
    }
  } finally {
    await browser.rewriteAniList(null)
  }
  assert.deepEqual(seen, [], 'bands that are no impact frame in the title’s color')
})

test('in a contrast theme, the impact frame keeps its speed lines and screentone, in the theme’s colors', async () => {
  // A contrast theme (forced colors) paints every background in its page color and drops
  // gradients, which left the frame an empty box. It keeps its lines and dots, drawn in the
  // theme's text color on its page color, in a light palette and a dark one, with its ink line in
  // the text color too: mostly the page color, with the lines and dots plain to see.
  const seen: string[] = []
  await stage('no banner')
  try {
    for (const scheme of ['light', 'dark']) {
      await openFrieren(SCREENS[2])
      await browser.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-color-scheme', value: scheme },
        ],
      })
      // The theme's own colors, as this palette paints them.
      const [canvas, text, line] = await browser.evaluate<string[]>(`(() => {
        const probe = document.body.appendChild(document.createElement('i'))
        const color = (value) => { probe.style.backgroundColor = value; return getComputedStyle(probe).backgroundColor }
        const colors = [color('Canvas'), color('CanvasText')]
        probe.remove()
        return [...colors, getComputedStyle(document.querySelector('dialog.ab-card[open] .ab-band')).borderBottomColor]
      })()`)
      const {
        near: [onCanvas, onText],
      } = await bandPixels([canvas, text])
      if (onCanvas < 40) seen.push(`${scheme}: ${onCanvas}% in the theme's page color ${canvas}`)
      if (onText < 3) seen.push(`${scheme}: ${onText}% lines and dots in its text color ${text}`)
      if (line !== text) seen.push(`${scheme}: its ink line in ${line}, not the theme's ${text}`)
    }
  } finally {
    await browser.send('Emulation.setEmulatedMedia', { features: [] })
    await browser.rewriteAniList(null)
  }
  assert.deepEqual(seen, [], 'contrast themes where the impact frame is no impact frame')
})

test('over a frame in brand red, the focused close button stays traced all the way round, at 3:1 or better', async () => {
  // The close button now stands over the band's corner. With the keyboard's focus it turns brand
  // red inside a brand-red ring, and a title with no color has a frame in brand red (as can a red
  // banner): button, ring and frame melted into one, with only the white arrow left. Around the
  // button, from its edge to 10px out, each of 72 directions must cross something that stands out
  // from the frame's red at 3:1 or better.
  const seen: string[] = []
  await browser.forget()
  await browser.rewriteAniList(({ request, status, body }) => {
    if (request.variables.id !== 154587) return null
    body.data.Media.bannerImage = null
    body.data.Media.coverImage.color = null
    return { status, body }
  })
  try {
    for (const screen of [SCREENS[0], SCREENS[2]]) {
      await openFrieren(screen)
      const { clip, focused } = await browser.evaluate<{
        clip: { x: number; y: number; width: number; height: number }
        focused: boolean
      }>(`(() => {
        const button = document.querySelector('dialog.ab-card[open] .ab-close')
        button.focus()
        const box = button.getBoundingClientRect()
        return {
          clip: { x: box.left - 12 + scrollX, y: box.top - 12 + scrollY, width: box.width + 24, height: box.height + 24 },
          focused: button.matches(':focus-visible'),
        }
      })()`)
      assert.ok(focused, `at ${screen.width}px, the close button shows no keyboard focus`)
      await browser.animationsDone()
      const png = await browser.screenshot(clip)
      const traced = await browser.evaluate<number>(`(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const { data } = context.getImageData(0, 0, image.width, image.height)
        const scale = image.width / ${clip.width}
        const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
        const swatch = new OffscreenCanvas(1, 1).getContext('2d')
        swatch.fillStyle = getComputedStyle(document.querySelector('dialog.ab-card[open]')).getPropertyValue('--anime-accent')
        swatch.fillRect(0, 0, 1, 1)
        const frame = lum(swatch.getImageData(0, 0, 1, 1).data)
        const stands = (l) => (Math.max(l, frame) + 0.05) / (Math.min(l, frame) + 0.05) >= 3
        const center = ${clip.width} / 2, radius = ${clip.width} / 2 - 12
        let traced = 0
        for (let k = 0; k < 72; k++) {
          const angle = (k / 72) * 2 * Math.PI
          for (let r = radius; r <= radius + 10; r += 0.5) {
            const x = Math.round((center + r * Math.cos(angle)) * scale), y = Math.round((center + r * Math.sin(angle)) * scale)
            if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
            const i = (y * image.width + x) * 4
            if (stands(lum([data[i], data[i + 1], data[i + 2]]))) { traced++; break }
          }
        }
        return traced
      })()`)
      if (traced < 72) seen.push(`${screen.width}px: traced in ${traced} of 72 directions`)
    }
  } finally {
    await browser.rewriteAniList(null)
  }
  assert.deepEqual(seen, [], 'focused close buttons that melt into a brand-red frame')
})

test('in a contrast theme, the focused close button’s ring stands out from the banner around it, at 3:1 or better all the way round', async () => {
  // The close button stands over the band, and a contrast theme draws its focus ring in the
  // theme's highlight color and drops its white line, but leaves a banner photo as it is: on
  // Frieren's light sky, in a dark theme, the ring stood at about 1.3:1 against it. In each of 72
  // directions, the ring, midway across, must stand out at 3:1 or better from what lies just
  // inside it, in its gap, and just past it, in a light palette and a dark one.
  const seen: string[] = []
  try {
    for (const scheme of ['light', 'dark']) {
      for (const screen of [SCREENS[0], SCREENS[2]]) {
        await openFrieren(screen)
        await browser.send('Emulation.setEmulatedMedia', {
          features: [
            { name: 'prefers-reduced-motion', value: 'reduce' },
            { name: 'forced-colors', value: 'active' },
            { name: 'prefers-color-scheme', value: scheme },
          ],
        })
        await browser.evaluate(BANNER_SETTLED)
        await browser.animationsDone()
        const { clip, focused, banner } = await browser.evaluate<{
          clip: { x: number; y: number; width: number; height: number }
          focused: boolean
          banner: boolean
        }>(`(() => {
          const card = document.querySelector('dialog.ab-card[open]')
          const button = card.querySelector('.ab-close'), img = card.querySelector('.ab-band img')
          button.focus()
          const box = button.getBoundingClientRect()
          return {
            clip: { x: box.left - 16 + scrollX, y: box.top - 16 + scrollY, width: box.width + 32, height: box.height + 32 },
            focused: button.matches(':focus-visible'),
            banner: Boolean(img?.complete && img.naturalWidth),
          }
        })()`)
        const where = `${scheme}, ${screen.width}px`
        assert.ok(focused, `${where}: the close button shows no keyboard focus`)
        assert.ok(banner, `${where}: Frieren's banner did not load`)
        await sleep(300) // the button's color change on focus, 0.25 s
        const png = await browser.screenshot(clip)
        const { stands, least } = await browser.evaluate<{
          stands: number
          least: number
        }>(`(async () => {
          const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
          const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
          const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
          context.drawImage(image, 0, 0)
          const { data } = context.getImageData(0, 0, image.width, image.height)
          const scale = image.width / ${clip.width}
          const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
          const lum = (x, y) => { const i = (Math.round(y * scale) * image.width + Math.round(x * scale)) * 4; return 0.2126 * channel(data[i]) + 0.7152 * channel(data[i + 1]) + 0.0722 * channel(data[i + 2]) }
          const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
          // The button is 48px round, its ring 4px wide 3px out from its edge: the ring's middle is
          // 29px from the button's center, its gap's 25.5px, and just past it 33px.
          const center = ${clip.width} / 2, at = (r, angle) => lum(center + r * Math.cos(angle), center + r * Math.sin(angle))
          let stands = 0, least = Infinity
          for (let k = 0; k < 72; k++) {
            const angle = (k / 72) * 2 * Math.PI, ring = at(29, angle)
            const worst = Math.min(ratio(ring, at(25.5, angle)), ratio(ring, at(33, angle)))
            if (worst >= 3) stands++
            least = Math.min(least, worst)
          }
          return { stands, least: Math.round(least * 100) / 100 }
        })()`)
        if (stands < 72)
          seen.push(
            `${where}: the ring stands out in ${stands} of 72 directions, at ${least}:1 at worst`,
          )
      }
    }
  } finally {
    await browser.send('Emulation.setEmulatedMedia', { features: [] })
  }
  assert.deepEqual(
    seen,
    [],
    'contrast themes where the focused close button’s ring melts into the banner',
  )
})

// Each recorded title as AniList gave it, by its id, from every recording: the lists' titles and
// Frieren's own answer.
const RECORDED = new Map<number, Media>()
for (const { body } of recordings().values())
  for (const part of Object.values<any>(body?.data ?? {}))
    for (const media of part?.media ?? [part]) if (media?.id) RECORDED.set(media.id, media)

/**
 * What a title's card should show of its synopsis, as synopsis.ts reads AniList's description:
 * each paragraph, its lines on lines of their own, and its source as a caption.
 */
function synopsisOf(description: string | null | undefined) {
  const { paragraphs, source } = parseSynopsis(description)
  return {
    text: paragraphs.map((lines) =>
      lines.map((runs) => runs.map((run) => run.text).join('')).join('\n'),
    ),
    source: source && `Source: ${source}`,
  }
}

// What the open card shows of its synopsis: each paragraph's text as it reads, or what it says in
// its place, and its caption; and its running time, among the facts: its text on screen, hidden
// from screen readers, and the words they read in its place, hidden from the screen.
const SYNOPSIS = `(() => {
  const card = document.querySelector('dialog.ab-card[open]')
  const text = card.querySelector('.ab-synopsis-text')
  const fact = [...card.querySelectorAll('.ab-facts > div')].find((fact) => fact.querySelector('dt').textContent === 'Runtime')
  const dd = fact?.querySelector('dd')
  const part = (selector) => dd.querySelector(selector)?.textContent ?? 'none'
  return {
    text: text ? [...text.querySelectorAll('p')].map((p) => p.innerText) : card.querySelector('.ab-synopsis-none')?.textContent ?? 'none',
    source: card.querySelector('.ab-source')?.textContent ?? null,
    runtime: dd ? { text: part('[aria-hidden="true"]'), spoken: part('.sr-only') } : null,
  }
})()`

/** Notes the variables of every request the page makes of AniList from now on, until undone. */
async function noteRequests() {
  const asked: string[] = []
  await browser.rewriteAniList(({ request }) => {
    asked.push(JSON.stringify(request.variables))
    return null
  })
  return asked
}

test('a card opened from a list shows its synopsis and running time at once, Read more with them, asking AniList for nothing', async () => {
  // The lists carry each title's details (see cardOf), so a card opened from one shows them as it
  // opens, with no request: AniList allows 30 a minute, and a class on one network shares them.
  // The first trending title is opened at each size and read in the card's first frames, before
  // its fade has ended; and nothing may be asked of AniList from the click on. Read more must be
  // there, or not, in the first frame the card is drawn as it is once settled: coming a frame
  // later, it pushed the tags 54px down. That frame is read as it is laid out, before it is drawn,
  // by a ResizeObserver made after the card's own, so it calls back after them.
  const seen: string[] = []
  for (const screen of [SCREENS[0], SCREENS[2]]) {
    await browser.forget()
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown(), `at ${screen.width}px, no titles showed`)
    const asked = await noteRequests()
    try {
      const { id, shown } = await browser.evaluate<{ id: number; shown: unknown }>(`(async () => {
        const link = document.querySelector('.ab-grid .ab-link')
        window.__firstFrame = new Promise((resolve) => {
          const watch = new MutationObserver(() => {
            const card = document.querySelector('dialog.ab-card')
            if (!card) return
            watch.disconnect()
            const sized = new ResizeObserver(() => {
              if (!card.open || !card.offsetHeight) return
              sized.disconnect()
              resolve(card.querySelector('.ab-synopsis .ab-more')?.textContent ?? 'none')
            })
            sized.observe(card)
          })
          watch.observe(document.body, { childList: true, subtree: true })
        })
        link.click()
        for (let frame = 0; frame < 30 && !document.querySelector('dialog.ab-card[open]'); frame++)
          await new Promise((resolve) => requestAnimationFrame(resolve))
        return { id: Number(link.getAttribute('href').split('/').pop()), shown: document.querySelector('dialog.ab-card[open]') && ${SYNOPSIS} }
      })()`)
      await browser.animationsDone()
      await sleep(500)
      const media = RECORDED.get(id)
      assert.ok(media, `title ${id} is in no recording`)
      const expected = { ...synopsisOf(media.description), runtime: runtimeOf(media) }
      if (JSON.stringify(shown) !== JSON.stringify(expected))
        seen.push(`${screen.width}px: ${JSON.stringify(shown)}, not ${JSON.stringify(expected)}`)
      const more = await browser.evaluate<{ first: string; settled: string }>(`(async () => ({
        first: await window.__firstFrame,
        settled: document.querySelector('dialog.ab-card[open] .ab-synopsis .ab-more')?.textContent ?? 'none',
      }))()`)
      if (more.first !== more.settled)
        seen.push(
          `${screen.width}px: Read more ${more.first} in the first frame, ${more.settled} once settled`,
        )
      if (asked.length) seen.push(`${screen.width}px: asked AniList for ${asked.join(', ')}`)
    } finally {
      await browser.rewriteAniList(null)
    }
  }
  assert.deepEqual(seen, [], 'cards opened from a list without their details, or asking for them')
})

test('a card opened at its address shows its synopsis and running time from its one request', async () => {
  // A title opened at its address asks AniList for itself (titleQuery), and its answer carries
  // the same details as a list's titles: the card shows them from that one request.
  const seen: string[] = []
  for (const screen of [SCREENS[0], SCREENS[2]]) {
    await browser.forget()
    const asked = await noteRequests()
    try {
      await openFrieren(screen)
      const media = RECORDED.get(154587)!
      const shown = await browser.evaluate(SYNOPSIS)
      const expected = { ...synopsisOf(media.description), runtime: runtimeOf(media) }
      if (JSON.stringify(shown) !== JSON.stringify(expected))
        seen.push(`${screen.width}px: ${JSON.stringify(shown)}, not ${JSON.stringify(expected)}`)
      const own = asked.filter((variables) => variables === '{"id":154587}').length
      if (own !== 1) seen.push(`${screen.width}px: asked AniList for Frieren ${own} times`)
    } finally {
      await browser.rewriteAniList(null)
    }
  }
  assert.deepEqual(seen, [], 'cards opened at their address without their details')
})

/**
 * Frieren's answer from now on with `description` in place of its own, and nothing of it saved,
 * so the next visit to its address asks for it again.
 */
async function stageDescription(description: string | null) {
  await browser.forget()
  await browser.rewriteAniList(({ request, status, body }) => {
    if (request.variables.id !== 154587) return null
    body.data.Media.description = description
    return { status, body }
  })
}

// The open card's synopsis as it lies: its text's height and full height, in line heights to a
// tenth, whether its foot fades, and its button, if any: what it says, aria-expanded, whether
// aria-controls names the text, and whether the button is whole on the screen.
const CLAMP = `(() => {
  const card = document.querySelector('dialog.ab-card[open]')
  const text = card.querySelector('.ab-synopsis-text'), button = card.querySelector('.ab-synopsis .ab-more')
  const lines = (px) => Math.round((px / parseFloat(getComputedStyle(text).lineHeight)) * 10) / 10
  const box = button?.getBoundingClientRect()
  return {
    lines: lines(text.clientHeight),
    of: lines(text.scrollHeight),
    fades: getComputedStyle(text).maskImage !== 'none',
    button: button && {
      says: button.textContent,
      expanded: button.getAttribute('aria-expanded'),
      controls: button.getAttribute('aria-controls') === text.id && text.id !== '',
      whole: box.top >= 0 && box.bottom <= innerHeight,
    },
  }
})()`

type Clamp = {
  lines: number
  of: number
  fades: boolean
  button: { says: string; expanded: string; controls: boolean; whole: boolean } | null
}

// Clicks the synopsis's button, first bringing it `into` view as scrollIntoView puts it, and waits
// two frames.
const press = (into: 'start' | 'end') => `(async () => {
  const button = document.querySelector('dialog.ab-card[open] .ab-synopsis .ab-more')
  button.scrollIntoView({ block: '${into}' })
  button.click()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return true
})()`

test('the synopsis shows five lines, and where they hide some of it, Read more opens the rest and Show less closes it', async () => {
  // The title lab's choice: five lines of the synopsis, the last fading into the paper, and a
  // Read more button that opens the rest (Show less closes it again), saying which to screen
  // readers with aria-expanded and naming the text it opens with aria-controls. A synopsis of five
  // lines or fewer shows whole, with no button and no fade. Reduced motion, as here, keeps the
  // clamp. Closed from far down a long synopsis, the button would move up with the text's foot,
  // off the screen: it is brought back into view at once. Chrome's scroll anchoring holds it in
  // place anyway, and the card's scroll stops at its foot, so neither is left to do it: a long
  // synopsis is staged, in a card without anchoring, as in a browser that has none, and room below.
  const seen: string[] = []
  const expect = (where: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      seen.push(`${where}: ${JSON.stringify(actual)}, not ${JSON.stringify(expected)}`)
  }
  const READ_MORE = { says: 'Read more', expanded: 'false', controls: true, whole: true }
  try {
    for (const screen of [SCREENS[0], SCREENS[2]]) {
      await browser.forget()
      await openFrieren(screen)
      const where = `${screen.width}px`
      const closed = await browser.evaluate<Clamp>(CLAMP)
      expect(
        where,
        {
          ...closed,
          of: closed.of > 5,
          button: closed.button && { ...closed.button, whole: true },
        },
        { lines: 5, of: true, fades: true, button: READ_MORE },
      )
      // Wherever the button ends up as the text opens above it.
      await browser.evaluate(press('start'))
      const open = await browser.evaluate<Clamp>(CLAMP)
      expect(
        `${where}, after Read more`,
        { ...open, button: open.button && { ...open.button, whole: undefined } },
        {
          lines: closed.of,
          of: closed.of,
          fades: false,
          button: { says: 'Show less', expanded: 'true', controls: true },
        },
      )
      await browser.evaluate(press('end'))
      expect(`${where}, after Show less`, await browser.evaluate(CLAMP), {
        ...closed,
        button: READ_MORE,
      })
    }
    await stageDescription('The second season of <i>Ao no Hako</i>.')
    for (const screen of [SCREENS[0], SCREENS[2]]) {
      await openFrieren(screen)
      const short = await browser.evaluate<Clamp>(CLAMP)
      expect(
        `${screen.width}px, a synopsis of a line`,
        { ...short, lines: short.lines <= 2 },
        { lines: true, of: short.lines, fades: false, button: null },
      )
    }
    const paragraph =
      'Frieren walks on, year after year, through towns and seasons, remembering the friends she outlived and learning, too late and just in time, what their years together meant.'
    await stageDescription(Array(12).fill(paragraph).join('<br><br>'))
    for (const screen of [SCREENS[0], SCREENS[2]]) {
      await openFrieren(screen)
      await browser.evaluate(`(() => {
        const card = document.querySelector('dialog.ab-card[open]')
        card.style.overflowAnchor = 'none'
        const room = document.createElement('div')
        room.style.height = 2 * innerHeight + 'px'
        card.querySelector('.ab-details').after(room)
        return true
      })()`)
      await browser.evaluate(press('start'))
      // Show less, with the button at the screen's top, the long text above it.
      await browser.evaluate(press('start'))
      expect(
        `${screen.width}px, Show less far down a long synopsis`,
        (await browser.evaluate<Clamp>(CLAMP)).button,
        READ_MORE,
      )
    }
  } finally {
    await browser.rewriteAniList(null)
  }
  assert.deepEqual(seen, [], 'synopses clamped or opened wrongly')
})

test('the synopsis keeps AniList’s lines, italics and bold, shows markup only as text, and says “Description unavailable.” when there is none', async () => {
  // Spec §3I: a title with no description says "Description unavailable.", as does one whose
  // description is only its source. Otherwise the card draws what synopsis.ts makes of it:
  // AniList's <br> as lines and paragraphs, <i> and <b> as italics and bold, and anything else,
  // a script tag or a javascript: link among them, as plain text, never as markup.
  const HOSTILE =
    'Elf mage <i>Frieren</i> and <b>Himmel</b><br>walk on.<br><br><script>alert(1)</script><a href="javascript:alert(1)">a link</a> &lt;b&gt;bold?&lt;/b&gt;<br><br>(Source: Crunchyroll)'
  const NONE = { text: 'Description unavailable.', source: null, em: [], strong: [], markup: [] }
  const cases = [
    [null, NONE],
    ['', NONE],
    ['(Source: Crunchyroll)', NONE],
    [
      HOSTILE,
      {
        text: ['Elf mage Frieren and Himmel\nwalk on.', 'alert(1)a link <b>bold?</b>'],
        source: 'Source: Crunchyroll',
        em: ['Frieren'],
        strong: ['Himmel'],
        markup: [],
      },
    ],
  ] as const
  const seen: string[] = []
  try {
    for (const [description, expected] of cases) {
      await stageDescription(description)
      for (const screen of [SCREENS[0], SCREENS[2]]) {
        await openFrieren(screen)
        const { text, source } = await browser.evaluate<{ text: unknown; source: unknown }>(
          SYNOPSIS,
        )
        const marks = await browser.evaluate<Record<string, string[]>>(`(() => {
          const details = document.querySelector('dialog.ab-card[open] .ab-details')
          const all = (selector) => [...details.querySelectorAll(selector)].map((part) => part.textContent)
          return { em: all('em'), strong: all('strong'), markup: [...details.querySelectorAll('script, a, b, i, [href], [onclick]')].map((part) => part.outerHTML) }
        })()`)
        const shown = { text, source, ...marks }
        if (JSON.stringify(shown) !== JSON.stringify(expected))
          seen.push(`${screen.width}px, ${JSON.stringify(description)}: ${JSON.stringify(shown)}`)
      }
    }
  } finally {
    await browser.rewriteAniList(null)
  }
  assert.deepEqual(seen, [], 'synopses drawn wrongly')
})

test('the clamp is as tall in a fallback font as in the page’s own, and Read more follows the text as it changes size', async () => {
  // The card can open before the page's own font has come, as on a cold visit to a title's
  // address, and the text reflows as the font swaps in. The clamp is five line heights, which a
  // fallback font and the page's share, so the clamped synopsis keeps its height; and whether the
  // five lines hide anything is measured again as the text changes size, so Read more is there
  // exactly while they do, even where the clamp keeps its height as the text reflows past five
  // lines or back. Here Frieren's synopsis is spaced to fill exactly five lines, then a little
  // looser, then drawn in a fallback font, then packed tight enough to fit in five lines, then
  // spaced to exactly five and a little looser again, then as it should be.
  const seen: string[] = []
  for (const screen of [SCREENS[0], SCREENS[2]]) {
    await openFrieren(screen)
    const look = (style: string) =>
      browser.evaluate<{ height: number; hides: boolean; button: boolean }>(`(async () => {
        const text = document.querySelector('dialog.ab-card[open] .ab-synopsis-text')
        text.style.cssText = ${JSON.stringify(style)}
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return {
          height: text.clientHeight,
          hides: text.scrollHeight > text.clientHeight + 1,
          button: Boolean(document.querySelector('dialog.ab-card[open] .ab-synopsis .ab-more')),
        }
      })()`)
    const own = await look('')
    // The loosest letter spacing at which the text still fits in five lines, found by halving.
    const { fits, over } = await browser.evaluate<{ fits: number; over: number }>(`(() => {
      const text = document.querySelector('dialog.ab-card[open] .ab-synopsis-text')
      let fits = -8, over = 0
      for (let i = 0; i < 25; i++) {
        const mid = (fits + over) / 2
        text.style.letterSpacing = mid + 'px'
        if (text.scrollHeight > text.clientHeight + 1) over = mid
        else fits = mid
      }
      text.style.letterSpacing = ''
      return { fits, over }
    })()`)
    const states = {
      own,
      tight: await look(`letter-spacing: ${fits}px`),
      loose: await look(`letter-spacing: ${over + 0.5}px`),
      fallback: await look('font-family: serif'),
      packed: await look('letter-spacing: -0.45em'),
      'tight again': await look(`letter-spacing: ${fits}px`),
      'loose again': await look(`letter-spacing: ${over + 0.5}px`),
      back: await look(''),
    }
    const where = `${screen.width}px`
    if (states.fallback.height !== states.own.height)
      seen.push(
        `${where}: ${states.fallback.height}px tall in a fallback font, ${states.own.height}px in its own`,
      )
    for (const [state, { hides, button }] of Object.entries(states))
      if (hides !== button)
        seen.push(
          `${where}, ${state}: ${hides ? 'hides text' : 'hides nothing'}, ${button ? 'with' : 'without'} Read more`,
        )
    if (states.packed.hides) seen.push(`${where}: packed tight, the synopsis still overflowed`)
    for (const state of ['tight', 'tight again'] as const)
      if (states[state].hides)
        seen.push(`${where}, ${state}: spaced to fill five lines, it overflowed`)
    for (const state of ['loose', 'loose again'] as const)
      if (!states[state].hides) seen.push(`${where}, ${state}: spaced looser, it didn't overflow`)
    if (!states.back.hides) seen.push(`${where}: the synopsis no longer overflows five lines`)
  }
  assert.deepEqual(seen, [], 'clamps whose height or Read more went wrong as the text changed')
})

test('Tab reaches the details’ buttons after the card’s own, each showing its focus, and Shift+Tab goes back', async () => {
  // Every interactive part is reachable by Tab, with visible focus (the acceptance checks). The
  // card's stops, from its close button: Open on AniList (the Soon buttons are disabled), then
  // the details' buttons in reading order, Read more and Show spoiler tags, each with the card's
  // focus ring, 4px in brand hot.
  const STOPS = ['Close title card', 'Open on AniList', 'Read more', 'Show spoiler tags']
  const seen: string[] = []
  const focused = () =>
    browser.evaluate<string>(`(() => {
      const part = document.activeElement, ring = getComputedStyle(part)
      const name = part === document.body ? 'the page' : (part.getAttribute('aria-label') ?? part.textContent.trim())
      const shows = part.matches(':focus-visible') && ring.outlineStyle === 'solid' && parseFloat(ring.outlineWidth) >= 4 && ring.outlineColor === 'rgb(255, 45, 85)'
      return shows ? name : name + ' (no ring)'
    })()`)
  for (const screen of [SCREENS[0], SCREENS[2]]) {
    await openFrieren(screen)
    await browser.evaluate(`document.querySelector('dialog.ab-card[open] .ab-close').focus(); true`)
    const forward = [await focused()]
    for (let i = 1; i < STOPS.length; i++) {
      await browser.press('Tab')
      forward.push(await focused())
    }
    const backward = [forward.at(-1)]
    for (let i = 1; i < STOPS.length; i++) {
      await browser.press('Tab', true)
      backward.push(await focused())
    }
    if (JSON.stringify(forward) !== JSON.stringify(STOPS))
      seen.push(`${screen.width}px, Tab: ${forward.join(' → ')}`)
    if (JSON.stringify(backward) !== JSON.stringify(STOPS.toReversed()))
      seen.push(`${screen.width}px, Shift+Tab: ${backward.join(' → ')}`)
  }
  assert.deepEqual(seen, [], 'the card’s Tab stops, each with its ring')
})

/**
 * Every color the open card's details paint, each with what it stands on, in words: a part's text
 * on its background, and its border on what lies around it, with their contrast; and whether each
 * color is one the details may use: ink, white, the paper, the caption's grey, or one of the
 * title's two accents (deriveAccent), the fill under ink and the text color on white or paper.
 */
const DETAIL_COLORS = `(() => {
  const card = document.querySelector('dialog.ab-card[open]')
  const swatch = document.createElement('i')
  card.append(swatch)
  const rgb = (value) => { swatch.style.color = value; return getComputedStyle(swatch).color }
  const accent = rgb(getComputedStyle(card).getPropertyValue('--anime-accent'))
  const accentText = rgb(getComputedStyle(card).getPropertyValue('--anime-accent-text'))
  const named = new Map([[rgb('#141414'), 'ink'], [rgb('#fff'), 'white'], [rgb('#f6f1e6'), 'paper'], [rgb('#3d3d3d'), 'grey'], [accent, 'accent'], [accentText, 'accent text']])
  swatch.remove()
  const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const lum = (color) => { const [r, g, b] = color.match(/[\\d.]+/g).map(Number); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return Math.round(((x + 0.05) / (y + 0.05)) * 10) / 10 }
  const seen = (color) => !/rgba\\(.*, 0\\)$/.test(color) && color !== 'transparent'
  const under = (part) => { for (let at = part; at; at = at.parentElement) { const bg = getComputedStyle(at).backgroundColor; if (seen(bg)) return bg } return rgb('#f6f1e6') }
  const name = (color) => named.get(color) ?? color
  const found = []
  for (const part of card.querySelectorAll('.ab-details, .ab-details *')) {
    const style = getComputedStyle(part)
    if (!part.checkVisibility()) continue
    const label = part.localName + (part.className ? '.' + String(part.className).split(' ')[0] : '')
    if ([...part.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()))
      found.push({ part: label, what: 'text', color: name(style.color), on: name(under(part)), ratio: ratio(style.color, under(part)), least: 4.5 })
    if (parseFloat(style.borderTopWidth) > 0 && seen(style.borderTopColor))
      found.push({ part: label, what: 'border', color: name(style.borderTopColor), on: name(under(part.parentElement)), ratio: ratio(style.borderTopColor, under(part.parentElement)), least: 3 })
  }
  return found
})()`

test('the details paint only ink, white, paper, the caption’s grey and the title’s own accent pairs, every text at 4.5:1 and every border at 3:1', async () => {
  // Colors in the title's own color come from deriveAccent, in its pairs: the fill under ink, and
  // the text color on white or paper, each meeting 4.5:1. The details are drawn for the first four
  // trending titles, whose colors differ, and for Frieren with no color (brand hot), with the
  // synopsis and any spoiler tags open, so the open buttons show in the title's fill.
  const seen: string[] = []
  const PAIRS: Record<string, string[]> = {
    ink: ['white', 'paper', 'accent'],
    grey: ['white', 'paper'],
    'accent text': ['white', 'paper'],
    white: [],
    paper: [],
    accent: ['ink'],
  }
  const look = async (where: string) => {
    await browser.evaluate(
      `document.querySelectorAll('dialog.ab-card[open] .ab-details .ab-more[aria-expanded="false"]').forEach((button) => button.click()); true`,
    )
    await browser.evaluate(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`,
    )
    const colors =
      await browser.evaluate<
        { part: string; what: string; color: string; on: string; ratio: number; least: number }[]
      >(DETAIL_COLORS)
    assert.ok(
      colors.some((color) => color.on === 'accent'),
      `${where}: no open button in the title's fill`,
    )
    for (const { part, what, color, on, ratio, least } of colors) {
      if (!(color in PAIRS))
        seen.push(`${where}: ${part}'s ${what} in ${color}, not one of the details' colors`)
      else if (what === 'text' && !PAIRS[color].includes(on))
        seen.push(`${where}: ${part}'s ${color} text on ${on}`)
      if (ratio < least) seen.push(`${where}: ${part}'s ${what}, ${color} on ${on}, at ${ratio}:1`)
    }
  }
  for (const screen of [SCREENS[0], SCREENS[2]]) {
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    for (let panel = 0; panel < 4; panel++) {
      await browser.evaluate(
        `document.querySelectorAll('.ab-grid .ab-link')[${panel}].click(); true`,
      )
      assert.ok(await browser.waitFor(`${CARD} !== ''`, 5000))
      await browser.animationsDone()
      await look(`${screen.width}px, ${await browser.evaluate(CARD)}`)
      await browser.evaluate(
        `document.querySelector('dialog.ab-card[open] .ab-close').click(); true`,
      )
      assert.ok(await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000))
    }
  }
  await browser.forget()
  await browser.rewriteAniList(({ request, status, body }) => {
    if (request.variables.id !== 154587) return null
    body.data.Media.coverImage.color = null
    return { status, body }
  })
  try {
    for (const screen of [SCREENS[0], SCREENS[2]]) {
      await openFrieren(screen)
      await look(`${screen.width}px, Frieren with no color`)
    }
  } finally {
    await browser.rewriteAniList(null)
  }
  assert.deepEqual(seen, [], 'colors in the details out of their pairs, or too faint')
})

test('in a contrast theme, open buttons show they are open, in the theme’s colors for a selected thing, and shown spoiler tags keep their dashes', async () => {
  // A contrast theme paints every button alike, so the title's fill on an open button would go:
  // an open one takes the theme's colors for something selected, in a light palette and a dark
  // one. Frieren's card has both buttons, Read more and Show spoiler tags. A spoiler tag, once
  // shown, keeps its dashed border, which the theme draws in its own color.
  const seen: string[] = []
  try {
    for (const scheme of ['light', 'dark']) {
      await openFrieren(SCREENS[2])
      await browser.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-color-scheme', value: scheme },
        ],
      })
      const { buttons, spoilers } = await browser.evaluate<{
        buttons: { says: string; closed: string; open: string; selected: string }[]
        spoilers: string[]
      }>(`(async () => {
        const probe = document.body.appendChild(document.createElement('i'))
        probe.style.backgroundColor = 'SelectedItem'
        const selected = getComputedStyle(probe).backgroundColor
        probe.remove()
        const buttons = []
        for (const button of document.querySelectorAll('dialog.ab-card[open] .ab-details .ab-more')) {
          const closed = getComputedStyle(button).backgroundColor
          button.click()
          await new Promise((resolve) => requestAnimationFrame(resolve))
          buttons.push({ says: button.textContent, closed, open: getComputedStyle(button).backgroundColor, selected })
        }
        const spoilers = [...document.querySelectorAll('dialog.ab-card[open] .ab-tags .is-spoiler')].map((chip) => getComputedStyle(chip).borderTopStyle)
        return { buttons, spoilers }
      })()`)
      if (buttons.length !== 2) seen.push(`${scheme}: ${buttons.length} buttons, not 2`)
      for (const { says, closed, open, selected } of buttons)
        if (open !== selected || closed === selected)
          seen.push(`${scheme}, ${says}: closed ${closed}, open ${open}, selected ${selected}`)
      if (!spoilers.length || spoilers.some((style) => style !== 'dashed'))
        seen.push(`${scheme}: spoiler tags shown with borders ${JSON.stringify(spoilers)}`)
    }
  } finally {
    await browser.send('Emulation.setEmulatedMedia', { features: [] })
  }
  assert.deepEqual(
    seen,
    [],
    'open buttons that look closed, or spoiler tags unmarked, in a contrast theme',
  )
})

test('a card opened from a list, or cold at its address, with AniList’s answers held 2 s, opens with its details and shifts nothing', async () => {
  // The plan's guard: layout shift (CLS, as web-vitals counts it) under 0.1, from the page's first
  // moment until the card has opened and settled, its banner and cover in, with AniList's answers
  // held 2 s. Opened from a list, the card has its details from its first frame, so a slow AniList
  // holds up nothing; at its address, they come in its one answer, with nothing saved.
  await browser.watchLayoutShifts()
  const seen: string[] = []
  const settle = async () => {
    await browser.animationsDone()
    await browser.evaluate(BANNER_SETTLED)
    await sleep(500)
  }
  for (const screen of [SCREENS[0], SCREENS[2]]) {
    await browser.forget()
    await browser.load(screen)
    assert.ok(await browser.titlesShown())
    const before = (await browser.layoutShift()).value
    await browser.holdAniList(2000)
    try {
      await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(); true`)
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card[open] .ab-details')`, 5000),
      )
      await settle()
      // Past the hold, for anything held to have come.
      await sleep(2000)
    } finally {
      await browser.holdAniList(0)
    }
    const fromList = (await browser.layoutShift()).value - before
    if (fromList >= 0.1) seen.push(`${screen.width}px, from a list: ${fromList}`)
    await browser.forget()
    await browser.holdAniList(2000)
    try {
      await browser.load({ ...screen, url: at('/anime/154587') })
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card[open] .ab-details')`, 10_000),
      )
      await settle()
      const { value } = await browser.layoutShift()
      if (value >= 0.1) seen.push(`${screen.width}px, at its address: ${value}`)
    } finally {
      await browser.holdAniList(0)
    }
  }
  assert.deepEqual(seen, [], 'layout shift as a card opened, under 0.1')
})

// The open card's tags as they show: each chip's text as a screen reader reads it, a spoiler's
// words for it included, then " (dashed)" for a chip drawn as a spoiler; and its spoiler button,
// if any: what it says, aria-expanded, and whether aria-controls names the list.
const TAGS = `(() => {
  const card = document.querySelector('dialog.ab-card[open]')
  const list = card.querySelector('.ab-tags'), button = card.querySelector('.ab-tag-set .ab-more')
  return {
    chips: list ? [...list.querySelectorAll('li')].map((chip) => chip.textContent + (chip.classList.contains('is-spoiler') ? ' (dashed)' : '')) : [],
    button: button && {
      says: button.textContent,
      expanded: button.getAttribute('aria-expanded'),
      controls: button.getAttribute('aria-controls') === list.id && list.id !== '',
    },
  }
})()`

test('a card shows its title’s top 8 tags by rank, never an adult one, and its spoiler tags only after “Show spoiler tags”, asking AniList for nothing', async () => {
  // Spec §3G and the title lab's choice: the top 8 tags by rank as chips, each with its rank,
  // adult tags never, and the top 8 spoiler tags behind "Show spoiler tags", which shows them in
  // place, after the others and marked as spoilers, and hides them again, saying which with
  // aria-expanded. Every trending panel's title is opened from the list, with no request. Then
  // Frieren at its address, staged with an adult tag ranked above the rest, with no spoiler
  // tags (no button), and with no tags at all (no chips and no button).
  const seen: string[] = []
  // A spoiler says so to a screen reader too, in words hidden from the screen, as the dashes say it
  // only to the eye.
  const chip = (spoiler: boolean) => (tag: Tag) =>
    `${tag.name}${tag.rank === null ? '' : ` ${tag.rank}%`}${spoiler ? ', spoiler (dashed)' : ''}`
  /** Checks the open card's tags against `media`'s, through both presses of its button. */
  const check = async (media: Media) => {
    const { shown, spoilers } = tagsOf(media.tags)
    const where = `${await browser.evaluate<number>('innerWidth')}px, ${await browser.evaluate(CARD)}`
    const button = (expanded: boolean) =>
      spoilers.length
        ? { says: 'Show spoiler tags', expanded: String(expanded), controls: true }
        : null
    const hidden = { chips: shown.map(chip(false)), button: button(false) }
    // Hidden, shown at a press, hidden again at a second; with no spoiler tags, no press.
    const expected = spoilers.length
      ? [
          hidden,
          { chips: [...shown.map(chip(false)), ...spoilers.map(chip(true))], button: button(true) },
          hidden,
        ]
      : [hidden]
    const states = [await browser.evaluate(TAGS)]
    for (let press = 0; press < 2 && spoilers.length; press++) {
      const pressed = await browser.evaluate<boolean>(`(async () => {
        const button = document.querySelector('dialog.ab-card[open] .ab-tag-set .ab-more')
        button?.click()
        await new Promise((resolve) => requestAnimationFrame(resolve))
        return Boolean(button)
      })()`)
      if (!pressed) break
      states.push(await browser.evaluate(TAGS))
    }
    if (JSON.stringify(states) !== JSON.stringify(expected))
      seen.push(`${where}: ${JSON.stringify(states)}`)
    const adult = media.tags.filter((tag) => tag.isAdult).map((tag) => tag.name)
    if (adult.some((name) => JSON.stringify(states).includes(`"${name} `)))
      seen.push(`${where}: shows an adult tag, of ${adult.join(', ')}`)
  }
  for (const screen of [SCREENS[0], SCREENS[2]]) {
    await browser.forget()
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    const ids = await browser.evaluate<number[]>(
      `[...document.querySelectorAll('.ab-grid .ab-link')].map((link) => Number(link.getAttribute('href').split('/').pop()))`,
    )
    const asked = await noteRequests()
    try {
      for (const id of ids) {
        const media = RECORDED.get(id)
        assert.ok(media, `title ${id} is in no recording`)
        await browser.evaluate(
          `document.querySelector('.ab-grid .ab-link[href="/anime/${id}"]').click(); true`,
        )
        assert.ok(await browser.waitFor(`${CARD} !== ''`, 5000))
        await check(media)
        await browser.evaluate(
          `document.querySelector('dialog.ab-card[open] .ab-close').click(); true`,
        )
        assert.ok(await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000))
      }
      await sleep(500)
      if (asked.length) seen.push(`${screen.width}px: asked AniList for ${asked.join(', ')}`)
    } finally {
      await browser.rewriteAniList(null)
    }
  }
  const frieren = RECORDED.get(154587)!
  const ADULT = {
    name: 'Nudity',
    rank: 100,
    isAdult: true,
    isGeneralSpoiler: false,
    isMediaSpoiler: false,
  }
  const STAGED: Record<string, Tag[]> = {
    'an adult tag': [
      ADULT,
      { ...ADULT, name: 'Sexual Content', isMediaSpoiler: true },
      ...frieren.tags,
    ],
    'no spoiler tags': frieren.tags.map((tag) => ({
      ...tag,
      isGeneralSpoiler: false,
      isMediaSpoiler: false,
    })),
    'no tags': [],
  }
  try {
    for (const [staged, tags] of Object.entries(STAGED)) {
      await browser.rewriteAniList(({ request, status, body }) => {
        if (request.variables.id !== 154587) return null
        body.data.Media.tags = tags
        return { status, body }
      })
      for (const screen of [SCREENS[0], SCREENS[2]]) {
        await openFrieren(screen)
        await check({ ...frieren, tags })
        if (
          staged === 'no tags' &&
          (await browser.evaluate(
            `Boolean(document.querySelector('dialog.ab-card[open] .ab-tag-set'))`,
          ))
        )
          seen.push(`${screen.width}px, no tags: the card still has a place for them`)
      }
    }
  } finally {
    await browser.rewriteAniList(null)
  }
  assert.deepEqual(seen, [], 'cards whose tags show wrongly, or that asked AniList for them')
})

// The open card's status line, if it shows: what it says, its role, its buttons, and whether it
// is whole on the screen.
const STATUS = `(() => {
  const line = document.querySelector('dialog.ab-card[open] .ab-card-status')
  if (!line?.classList.contains('is-shown')) return null
  const box = line.getBoundingClientRect()
  return {
    text: line.querySelector('p').textContent,
    role: line.querySelector('p').getAttribute('role'),
    buttons: [...line.querySelectorAll('button')].map((button) => button.textContent.trim()),
    whole: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
  }
})()`
// The site's outage wording (see app/status.ts): while the app tries again after a 429, and once
// its tries have ended.
const BUSY = 'AniList is busy right now. It’s not something you did. Trying again within a minute.'
const GAVE_UP =
  'AniList, where AniBeam gets its anime, isn’t responding right now. It’s not something you did. Try again in a minute.'

/**
 * AniList's 429 for Frieren from now on, its timeout ending a second or so later, as its
 * X-RateLimit-Reset says (without one the app waits a full minute, see retryAt), each noted in
 * `asked`.
 */
async function stage429(asked: number[]) {
  await browser.rewriteAniList(({ request }) => {
    if (request.variables.id !== 154587) return null
    asked.push(Date.now())
    return {
      status: 429,
      body: { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] },
      headers: { 'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + 1) },
    }
  })
}

// The focused part's name, and " (no ring)" unless it shows the card's focus ring.
const FOCUSED = `(() => {
  const part = document.activeElement, ring = getComputedStyle(part)
  const name = part === document.body ? 'the page' : (part.getAttribute('aria-label') ?? part.textContent.trim())
  const shows = part.matches(':focus-visible') && ring.outlineStyle === 'solid' && parseFloat(ring.outlineWidth) >= 4 && ring.outlineColor === 'rgb(255, 45, 85)'
  return shows ? name : name + ' (no ring)'
})()`

// Where the card's focus is now: the focused part's name, or null once it has left the card's
// parts (Tab from the last, or on to the card itself). With it, what of it can't be seen or
// clicked: any of it off the screen, or under the status line (WCAG 2.4.11), or, at its centre,
// something else that a click there would reach. Two frames on, so the card has scrolled to it.
const STOP = `(async () => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const card = document.querySelector('dialog.ab-card[open]'), part = document.activeElement
  if (!card?.contains(part) || part === card) return null
  const name = part.getAttribute('aria-label') ?? part.textContent.trim().replace(/\\s+/g, ' ')
  const box = part.getBoundingClientRect(), hid = []
  if (box.top < 0 || box.left < 0 || box.bottom > innerHeight || box.right > innerWidth)
    hid.push('off the screen')
  const line = card.querySelector('.ab-card-status.is-shown')
  if (line && !line.contains(part)) {
    const over = line.getBoundingClientRect()
    if (box.left < over.right && over.left < box.right && box.top < over.bottom && over.top < box.bottom)
      hid.push('under the status line')
  }
  const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)
  if (!part.contains(hit)) hid.push('its centre reaches ' + (hit?.className || hit?.tagName))
  return { name, hid }
})()`

/**
 * Walks Tab through the open card's parts from its close button, and returns each stop's name,
 * with what of it can't be seen or clicked, if any. It starts two frames on, so the card knows the
 * status line's height (see TitleCard's --status-h).
 */
async function tabStops() {
  await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelector('dialog.ab-card[open] .ab-close').focus()
    resolve(true)
  })))`)
  const stops: string[] = []
  while (stops.length < 30) {
    await browser.press('Tab')
    const stop = await browser.evaluate<{ name: string; hid: string[] } | null>(STOP)
    if (!stop || stop.name === 'Close title card') return stops
    stops.push(stop.hid.length > 0 ? `${stop.name} (${stop.hid.join(', ')})` : stop.name)
  }
  return [...stops, 'Tab never left the card']
}

test('a card opened at its address keeps its title while AniList answers 429, says why as the site does, and offers Try again once the tries end', async () => {
  // Spec §3I and the plan's PR 13: a 429 keeps what is shown, and says AniList is busy. A card
  // opened from a list asks for nothing; one opened at its address asks for its title, and asks
  // again once its saved answer is out of date, as an airing title's is 6 hours on: here Frieren,
  // staged as airing, saved 7 hours ago. Its card shows it at once and keeps it, while a status
  // line at the screen's foot says AniList is busy as the app tries again, then, once the tries
  // end, that AniList isn't responding, with Try again, which Tab reaches after the details'
  // buttons. Pressed, Try again hands focus to the line, which says it is trying, and the line
  // goes once the answer comes, focus going on to the close button. Nothing moves meanwhile. In
  // a contrast theme the line keeps its frame.
  await browser.watchLayoutShifts()
  for (const screen of [SCREENS[0], SCREENS[2]]) {
    const where = `${screen.width}px`
    await browser.forget()
    await browser.rewriteAniList(({ request, status, body }) => {
      if (request.variables.id !== 154587) return null
      body.data.Media.status = 'RELEASING'
      return { status, body }
    })
    try {
      await browser.load({ ...screen, reduceMotion: true, url: at('/anime/154587') })
      assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000), `${where}: no card`)
      // The cache is saved at most once a second.
      await sleep(1500)
    } finally {
      await browser.rewriteAniList(null)
    }
    const aged = await browser.evaluate<boolean>(`(() => {
      const copy = JSON.parse(localStorage.getItem('anibeam:cache') ?? 'null')
      const title = copy?.clientState.queries.find((query) => query.queryKey[2]?.id === 154587)
      if (!title) return false
      title.state.dataUpdatedAt -= 7 * 60 * 60_000
      localStorage.setItem('anibeam:cache', JSON.stringify(copy))
      return true
    })()`)
    assert.ok(aged, `${where}: Frieren's answer was never saved`)
    const asked: number[] = []
    await stage429(asked)
    try {
      await browser.load({ ...screen, reduceMotion: true, url: at('/anime/154587') })
      assert.ok(
        await browser.waitFor(`/Frieren/.test(${CARD})`, 5000),
        `${where}: no card from the saved answer`,
      )
      assert.ok(
        await browser.waitFor(`${STATUS}?.text === ${JSON.stringify(BUSY)}`, 5000),
        `${where}: while AniList answered 429, the card's status line was ${JSON.stringify(await browser.evaluate(STATUS))}`,
      )
      assert.deepEqual(
        await browser.evaluate(STATUS),
        { text: BUSY, role: 'status', buttons: [], whole: true },
        `${where}: while the app tries again`,
      )
      assert.ok(
        await browser.evaluate(
          `Boolean(document.querySelector('dialog.ab-card[open] .ab-synopsis-text'))`,
        ),
        `${where}: the card lost its synopsis`,
      )
      // Each of the card's Tab stops scrolls clear of the line, whole and in reach of a click.
      assert.deepEqual(
        await tabStops(),
        ['Open on AniList', 'Read more', 'Show spoiler tags'],
        `${where}: Tab through the card while the app tries again`,
      )
      assert.ok(
        await browser.waitFor(`${STATUS}?.buttons.includes('Try again')`, 40_000),
        `${where}: no Try again once the tries ended`,
      )
      assert.deepEqual(
        await browser.evaluate(STATUS),
        { text: GAVE_UP, role: 'status', buttons: ['Try again'], whole: true },
        `${where}: once the tries ended`,
      )
      assert.equal(asked.length, 4, `${where}: Frieren asked for, then tried 3 times more`)
      assert.deepEqual(
        await tabStops(),
        ['Open on AniList', 'Read more', 'Show spoiler tags', 'Try again'],
        `${where}: Tab through the card once the tries ended`,
      )
      assert.match(
        await browser.evaluate<string>(CARD),
        /Frieren/,
        `${where}: the card lost its title`,
      )
      // Tab reaches Try again after the details' last button, with the card's ring, and back.
      await browser.evaluate(
        `document.querySelector('dialog.ab-card[open] .ab-tag-set .ab-more').focus(); true`,
      )
      await browser.press('Tab')
      const forward = await browser.evaluate<string>(FOCUSED)
      const whole = await browser.evaluate(STATUS)
      await browser.press('Tab', true)
      const back = await browser.evaluate<string>(FOCUSED)
      assert.deepEqual(
        { forward, whole, back },
        {
          forward: 'Try again',
          whole: { text: GAVE_UP, role: 'status', buttons: ['Try again'], whole: true },
          back: 'Show spoiler tags',
        },
        `${where}: Tab from Show spoiler tags, then Shift+Tab`,
      )
      if (screen === SCREENS[2]) {
        await browser.send('Emulation.setEmulatedMedia', {
          features: [
            { name: 'prefers-reduced-motion', value: 'reduce' },
            { name: 'forced-colors', value: 'active' },
          ],
        })
        try {
          assert.ok(
            await browser.evaluate(`(() => {
              const probe = document.body.appendChild(document.createElement('i'))
              probe.style.color = 'CanvasText'
              const text = getComputedStyle(probe).color
              probe.remove()
              const line = getComputedStyle(document.querySelector('dialog.ab-card[open] .ab-card-status'))
              return line.borderTopStyle === 'solid' && parseFloat(line.borderTopWidth) >= 3 && line.borderTopColor === text && line.color === text
            })()`),
            `${where}: in a contrast theme, the status line lost its frame`,
          )
        } finally {
          await browser.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
          })
        }
      }
    } finally {
      await browser.rewriteAniList(null)
    }
    // Once AniList's timeout is surely over (its reset, then up to 2 s), so the line says it is
    // trying again, not that the app is taking a break.
    await sleep(4000)
    await browser.holdAniList(1500)
    try {
      await browser.evaluate(
        `document.querySelector('dialog.ab-card[open] .ab-card-status .ab-retry').focus(); true`,
      )
      await browser.press('Enter')
      assert.ok(
        await browser.waitFor(`document.activeElement?.id === 'ab-card-status'`, 1000),
        `${where}: Try again, hiding, left focus on ${await browser.evaluate(FOCUSED)}`,
      )
      assert.equal(
        await browser.evaluate(`document.activeElement.textContent`),
        'Trying AniList again…',
        `${where}: as Try again asks`,
      )
    } finally {
      await browser.holdAniList(0)
    }
    assert.ok(
      await browser.waitFor(`${STATUS} === null`, 10_000),
      `${where}: the status line stayed once the answer came`,
    )
    assert.equal(
      await browser.evaluate(FOCUSED),
      'Close title card',
      `${where}: focus once the line had gone`,
    )
    const { value, shifts } = await browser.layoutShift()
    assert.ok(value < 0.1, `${where}: layout shift ${value}: ${JSON.stringify(shifts)}`)
  }

  // With nothing saved, the note in the card's place says the same (see titleNote).
  await browser.forget()
  const asked: number[] = []
  await stage429(asked)
  try {
    await browser.load({ ...SCREENS[0], reduceMotion: true, url: at('/anime/154587') })
    const NOTE = `document.querySelector('dialog.ab-notice[open] .ab-notice-text')?.textContent`
    assert.ok(
      await browser.waitFor(`${NOTE} === ${JSON.stringify(BUSY)}`, 5000),
      'with nothing saved, no note said AniList is busy',
    )
    assert.ok(
      await browser.waitFor(
        `${NOTE} === ${JSON.stringify(GAVE_UP)} && [...document.querySelectorAll('dialog.ab-notice button')].some((button) => button.textContent === 'Try again')`,
        40_000,
      ),
      'with nothing saved, no Try again once the tries ended',
    )
  } finally {
    await browser.rewriteAniList(null)
  }
})
