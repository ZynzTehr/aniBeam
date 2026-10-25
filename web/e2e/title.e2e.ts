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
import { POOL_PAGES, recordings } from './recordings.ts'

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
  // button needs to stand clear of the ink line, 64px, and the band keeps its place inside the
  // border there too: no button in the copy is wider than its column, as "Save to My List Soon"
  // (213px) was, pushing the column, and the band with it, 2.5px past the sheet's padding. On a
  // screen under 500px tall, as a phone held sideways, stacked (667x375) or not (844x390), the
  // band, its ink line in, is a third of the screen's height at most (32svh), and never under
  // 64px.
  const seen: string[] = []
  try {
    for (const banner of Object.keys(BANNERS) as Banner[]) {
      await stage(banner)
      for (const screen of [
        { width: 280, height: 653, phone: true },
        ...SCREENS,
        { width: 667, height: 375, phone: true },
        { width: 844, height: 390, phone: true },
      ]) {
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
          const wide = innerWidth <= 820 ? Math.max(64, box.width * 4 / 19) : Math.min(420, Math.max(200, innerWidth / 4))
          // Under 500px tall, a third of the screen at most.
          const height = innerHeight <= 500 ? Math.min(wide, Math.max(64, innerHeight * 0.32)) : wide
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
// Frieren's own answer, but not a mood pool's pages (POOL_PAGES), whose copies no card opens.
const RECORDED = new Map<number, Media>()
for (const { body } of recordings().values())
  for (const [name, part] of Object.entries<any>(body?.data ?? {}))
    if (!POOL_PAGES.includes(name))
      for (const media of part?.media ?? [part]) if (media?.id) RECORDED.set(media.id, media)

// A card opened from a list shows the list's copy of its title, so each check reads that copy: not
// a mood pool's (see POOL_PAGES), whose figures can differ from the strip's (AniList answered it
// at another moment) and which carries the title's relations.
test('each recorded title is the copy a list has, not a mood pool’s', () => {
  assert.deepEqual(
    [...RECORDED.values()].filter((media) => 'relations' in media).map((media) => media.id),
    [],
    'titles taken from a mood pool’s pages',
  )
})

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

// The open card's synopsis as it lies, frame by frame, from a click on its button on, brought
// `into` view first as scrollIntoView puts it, for 900 ms. The click is a mouse's (its pointerType
// 'mouse'). Each frame is read in its turn, after the page's own work for the frame, as it will be
// drawn: the text's height, full height, top and line height, whether text spills out of its box
// (taller than it, and not clipped), how far the button and the tags lie below the text's foot,
// where its fade lies (its mask's position, or null with none), the button's words, aria-expanded
// and whether it is whole on the screen, the card's scroll and the text's animations. In the first
// frame `at` milliseconds on or later: `reverse` clicks the button again, `squeeze` narrows the
// text to 30ch, as a phone turning or a window narrowing reflows it, and `wheel` scrolls the card
// 400px up as a mouse wheel does. `before` is the synopsis just before the first click, `pressed`
// just after it, in the same task, before any frame, `acted` the frame the second act came in, and
// `keys` the properties the text's animations were given, by name.
const FRAMES = (
  into: 'start' | 'center',
  then: { at: number; act: 'reverse' | 'squeeze' | 'wheel' } | null = null,
) => `(async () => {
  const card = document.querySelector('dialog.ab-card[open]')
  const text = card.querySelector('.ab-synopsis-text'), button = card.querySelector('.ab-synopsis .ab-more')
  const read = (at) => {
    const box = text.getBoundingClientRect(), style = getComputedStyle(text), own = button.getBoundingClientRect()
    const tags = card.querySelector('.ab-tag-set')?.getBoundingClientRect() ?? own
    return {
      at: Math.round(at),
      height: box.height,
      full: text.scrollHeight,
      top: box.top,
      line: parseFloat(style.lineHeight),
      spills: text.scrollHeight > text.clientHeight + 1 && style.overflowY === 'visible',
      below: [own.top - box.bottom, tags.top - box.bottom],
      fade: style.maskImage === 'none' ? null : style.maskPosition,
      says: button.textContent,
      expanded: button.getAttribute('aria-expanded'),
      whole: own.top >= 0 && own.bottom <= innerHeight,
      scroll: card.scrollTop,
      moving: text.getAnimations().length,
    }
  }
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
  const keys = new Set(), animate = text.animate
  text.animate = function (frames, options) {
    Object.keys(frames).forEach((key) => keys.add(key))
    return animate.call(this, frames, options)
  }
  button.scrollIntoView({ block: '${into}' })
  await frame()
  await frame()
  const before = read(0), frames = [], then = ${JSON.stringify(then)}
  let acted = null
  const click = () =>
    button.dispatchEvent(new PointerEvent('click', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
  const start = performance.now()
  click()
  const pressed = read(0)
  while (performance.now() - start < 900) {
    await frame()
    const at = performance.now() - start
    frames.push(read(at))
    if (then && acted === null && at >= then.at) {
      acted = frames.length
      if (then.act === 'reverse') click()
      if (then.act === 'squeeze') text.style.maxWidth = '30ch'
      if (then.act === 'wheel') {
        card.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -400 }))
        card.scrollTop -= 400
      }
    }
  }
  delete text.animate
  return { before, pressed, frames, acted, keys: [...keys] }
})()`

type Frame = {
  at: number
  height: number
  full: number
  top: number
  line: number
  spills: boolean
  below: number[]
  fade: string | null
  says: string
  expanded: string | null
  whole: boolean
  scroll: number
  moving: number
}
type Frames = {
  before: Frame
  pressed: Frame
  frames: Frame[]
  acted: number | null
  keys: string[]
}

// How far down the fade lies, in percent of the room it has, from a mask's position: 100 at the
// clamp's foot, 0 once it is out of sight below the text.
const fadeAt = (fade: string | null) =>
  fade === null ? null : parseFloat(fade.trim().split(/\s+/)[1] ?? 'NaN')

/**
 * What went wrong in a smooth change of the synopsis's height, from `start` through `frames`, for a
 * press `pressedAt` ms on: it must go one way only, through at least five heights in between, and
 * reach its new height, the whole text's opening or the `clamp`'s closing, within 450 ms, no frame
 * showing it at once, with no text spilling from its box, the button and the tags keeping their
 * places below its foot, aria-expanded saying the new state from the first frame, and, read in
 * `pressed` as the press itself ended, before any frame, already then; and the fade moving part
 * way in three frames or more, out of sight below the text as it opens, back at the clamp's foot
 * closed. Closed, the text is exactly five of its line heights tall, and the opening starts there:
 * the fade lies at the clamp's foot before the press, and in the first frame where five line
 * heights and the height put it. In every frame the fade lies where the height puts it, at the
 * clamp's foot at the clamp's height and out of sight at the full height, in proportion between,
 * so it neither leaps at the start nor snaps back at the end. As the text opens at a pointer's
 * press (FRAMES's is a mouse's), the reader keeps their place: the card doesn't scroll, and the
 * first new line, the clamp's foot, stays on the screen in every frame, while the button may go
 * down off it. As the text closes, the button stays whole on the screen if it was.
 */
function judgeSmooth(
  where: string,
  start: Frame,
  frames: Frame[],
  pressedAt: number,
  opening: boolean,
  clamp: number,
  pressed: Frame | null = null,
): string[] {
  const problems: string[] = []
  const end = frames.at(-1)!
  const shut = opening ? start : end
  if (Math.abs(shut.height - 5 * shut.line) > 0.5)
    problems.push(`${where}: closed it was ${shut.height}px tall, not five lines of ${shut.line}px`)
  if (opening) {
    if (fadeAt(start.fade) !== 100)
      problems.push(`${where}: closed, its fade lay at ${fadeAt(start.fade)}%, not 100%`)
    const first = frames[0]
    const five = 5 * first.line
    const due = 100 - Math.min(Math.max((first.height - five) / (first.full - five), 0), 1) * 100
    if (!(Math.abs((fadeAt(first.fade) ?? NaN) - due) <= 3))
      problems.push(
        `${where}: the opening didn't start at five lines: its first frame put the fade at ${fadeAt(first.fade)}% at ${first.height}px, not ${Math.round(due * 10) / 10}%`,
      )
    const shifted = frames.find((frame) => Math.abs(frame.scroll - start.scroll) > 1)
    if (shifted)
      problems.push(
        `${where}: the card scrolled from ${start.scroll}px to ${shifted.scroll}px at ${shifted.at} ms, where a pointer's press keeps the reader's place`,
      )
  }
  if (pressed && pressed.expanded !== String(opening))
    problems.push(`${where}: aria-expanded still said ${pressed.expanded} as the press ended`)
  if (opening && Math.abs(end.height - end.full) > 1)
    problems.push(`${where}: ended ${end.height}px tall, not its full ${end.full}px`)
  if (Math.abs(frames[0].height - end.height) < 1 && Math.abs(start.height - end.height) >= 1)
    problems.push(`${where}: its first frame showed its new height, ${end.height}px, at once`)
  const way = opening ? 1 : -1
  frames.forEach((frame, i) => {
    const last = i ? frames[i - 1] : start
    if ((frame.height - last.height) * way < -0.5)
      problems.push(
        `${where}: went back from ${last.height}px to ${frame.height}px at ${frame.at} ms`,
      )
  })
  const low = Math.min(start.height, end.height) + 1
  const high = Math.max(start.height, end.height) - 1
  const between = frames.filter((frame) => frame.height > low && frame.height < high).length
  if (between < 5)
    problems.push(`${where}: ${between} frames between ${start.height}px and ${end.height}px`)
  const settled = frames.findIndex((_, i) =>
    frames.slice(i).every((frame) => Math.abs(frame.height - end.height) < 0.5),
  )
  const took = frames[settled].at - pressedAt
  if (took > 450) problems.push(`${where}: took ${took} ms to reach ${end.height}px`)
  if (!opening && Math.abs(end.height - clamp) > 1)
    problems.push(`${where}: ended ${end.height}px tall, not the clamp's ${clamp}px`)
  const spilt = frames.filter((frame) => frame.spills)
  if (spilt.length) problems.push(`${where}: text spilt from its box at ${spilt[0].at} ms`)
  const moved = frames.filter((frame) =>
    frame.below.some((gap, i) => Math.abs(gap - start.below[i]) > 1),
  )
  if (moved.length)
    problems.push(
      `${where}: the button and tags lay ${moved[0].below.map(Math.round)}px below the text's foot at ${moved[0].at} ms, not ${start.below.map(Math.round)}px`,
    )
  const said = frames.filter((frame) => frame.expanded !== String(opening))
  if (said.length)
    problems.push(`${where}: aria-expanded said ${said[0].expanded} at ${said[0].at} ms`)
  const hidden = frames.filter((frame) => !frame.whole)
  if (!opening && start.whole && hidden.length)
    problems.push(`${where}: the button left the screen at ${hidden[0].at} ms`)
  const lost = frames.filter((frame) => frame.top + clamp < 0)
  if (opening && lost.length)
    problems.push(
      `${where}: the first new line went off the screen's top, to ${Math.round(lost[0].top + clamp)}px, at ${lost[0].at} ms`,
    )
  const fades = frames.map((frame) => fadeAt(frame.fade))
  const fading = fades.filter((at) => at !== null && at > 1 && at < 99).length
  if (fading < 3) problems.push(`${where}: the fade was part way in ${fading} frames`)
  if (fades.at(-1) !== (opening ? null : 100))
    problems.push(`${where}: the fade ended at ${fades.at(-1)}, not ${opening ? 'gone' : 100}`)
  const astray = frames.find((frame, i) => {
    const room = Math.min(Math.max((frame.height - clamp) / (frame.full - clamp), 0), 1)
    return fades[i] !== null && Math.abs(fades[i]! - (100 - room * 100)) > 3
  })
  if (astray)
    problems.push(
      `${where}: the fade lay at ${fadeAt(astray.fade)}% at ${astray.height}px, ${astray.at} ms`,
    )
  if (end.moving) problems.push(`${where}: ${end.moving} animations still on the text 900 ms on`)
  return problems
}

// The fade's position is animated by its prefixed name as well as its own: Chrome 111 to 119, in
// the browser floor (spec §4), know only -webkit-mask-position, and drop a name they don't know,
// so the fade would stay put as the text moved. No browser here is that old, so this reads the
// names the animation was given.
const prefixed = (where: string, { keys }: Frames) =>
  keys.includes('maskPosition') && !keys.includes('webkitMaskPosition')
    ? [`${where}: the fade was animated as ${keys}, with no webkitMaskPosition`]
    : []

/** What went wrong in an instant change, as under reduced motion: nothing in between, no motion. */
function judgeInstant(where: string, { before, frames }: Frames): string[] {
  const end = frames.at(-1)!
  const problems: string[] = []
  if (Math.abs(frames[0].height - end.height) > 0.5)
    problems.push(`${where}: ${frames[0].height}px in its first frame, ${end.height}px at the end`)
  if (Math.abs(before.height - end.height) < 1) problems.push(`${where}: its height didn't change`)
  const moving = frames.filter((frame) => frame.moving)
  if (moving.length) problems.push(`${where}: the text was animated at ${moving[0].at} ms`)
  return problems
}

test('with motion allowed, Read more grows the synopsis to its full height and Show less shrinks it, smoothly, and a second press turns it back from where it is', async () => {
  // The user's ask: Read more opened the rest of the synopsis at once, a jolt. Now its height
  // moves from the clamp's five lines to the whole text, and back for Show less, in about 300 ms
  // with an ease out, the content below moving with its foot, never a frame showing the whole text
  // first, the fade at its foot sliding out of sight below it as it opens and back as it closes,
  // and Show less's button kept on the screen. Opened by a pointer, as here, the reader keeps
  // their place: the text opens below the lines being read, and the card doesn't scroll (on a
  // phone a long text pushes the button far down, and following it whipped those lines up off the
  // screen). Following Show less's button stops as soon as the visitor scrolls. A second press
  // part way turns it back from where it is, and a text that reflows as it opens grows on to its
  // new height, with no snap at the end. In the card at Frieren's address and in one opened over
  // Discover from a search, from 280 to 1440 px, in a fallback font, and with a long synopsis,
  // closed far down it in a card without scroll anchoring, as in Safari. Reduced motion, on the
  // device or set on the site, keeps the change instant, with no animation (the walk in
  // discover.e2e.ts holds the rest of the card), and a long text opened on a phone by a pointer
  // keeps the reader's place there too. A key's press is the next check's.
  const seen: string[] = []
  const motion = async (screen: { width: number; height: number; phone?: boolean }) => {
    await browser.forget()
    await browser.load({ ...screen, url: at('/anime/154587') })
    assert.ok(
      await browser.waitFor(`document.querySelector('dialog.ab-card.is-landed')`, 10_000),
      `at ${screen.width}px, no card landed for Frieren`,
    )
    await browser.animationsDone()
  }
  // Read more, then Show less, each from rest, with the button `into` view first.
  const both = async (where: string, into: 'start' | 'center' = 'center') => {
    const opened = await browser.evaluate<Frames>(FRAMES('center'))
    const clamp = opened.before.height
    seen.push(
      ...judgeSmooth(
        `${where}, Read more`,
        opened.before,
        opened.frames,
        0,
        true,
        clamp,
        opened.pressed,
      ),
      ...prefixed(`${where}, Read more`, opened),
    )
    const closed = await browser.evaluate<Frames>(FRAMES(into))
    seen.push(
      ...judgeSmooth(
        `${where}, Show less`,
        closed.before,
        closed.frames,
        0,
        false,
        clamp,
        closed.pressed,
      ),
      ...prefixed(`${where}, Show less`, closed),
    )
    if (closed.frames.at(-1)?.says !== 'Read more') seen.push(`${where}: Show less didn't close`)
  }
  // The steps from one frame to the next, in height, of `frames`.
  const steps = (frames: Frame[]) =>
    frames.slice(1).map((frame, i) => Math.abs(frame.height - frames[i].height))
  const PHONE = { width: 280, height: 653, phone: true }
  try {
    for (const screen of [PHONE, SCREENS[0], SCREENS[2]]) {
      await motion(screen)
      await both(`${screen.width}px at its address`)
      // Read more, then Show less 120 ms on, part way.
      const turned = await browser.evaluate<Frames>(FRAMES('center', { at: 120, act: 'reverse' }))
      const where = `${screen.width}px, Show less part way`
      const back = turned.acted!
      const from = turned.frames[back - 1]
      const jump = Math.abs(turned.frames[back].height - from.height)
      if (jump > Math.max(...steps(turned.frames.slice(0, back)), 0) + 2)
        seen.push(`${where}: jumped ${Math.round(jump)}px from ${from.height}px as it turned back`)
      const ahead = turned.frames.slice(back)
      seen.push(...judgeSmooth(where, from, ahead, from.at, false, turned.before.height))
      if (from.height <= turned.before.height + 1 || from.height >= from.full - 1)
        seen.push(`${where}: ${from.height}px at 120 ms, not part way`)
    }
    // Read more, the text narrowed 100 ms on, near doubling its full height: it grows on to its new
    // full height, with no step from one frame to the next bigger than a fifth of the way it still
    // had to go, where it grew to the old height and then snapped to the new one in a frame.
    await motion(SCREENS[2])
    const squeezed = await browser.evaluate<Frames>(FRAMES('center', { at: 100, act: 'squeeze' }))
    const narrowed = squeezed.acted!
    const way = squeezed.frames.at(-1)!.full - squeezed.frames[narrowed - 1].height
    const leaps = steps(squeezed.frames.slice(narrowed - 1))
    const leap = leaps.findIndex((step) => step > way / 5)
    if (leap >= 0)
      seen.push(
        `1440px, narrowed as it opened: leapt ${Math.round(leaps[leap])}px at ${squeezed.frames[narrowed + leap].at} ms, of the ${Math.round(way)}px it had still to go`,
      )
    const last = squeezed.frames.at(-1)!
    if (Math.abs(last.height - last.full) > 1)
      seen.push(`1440px, narrowed as it opened: ended ${last.height}px tall, not ${last.full}px`)
    for (const screen of [SCREENS[0], SCREENS[2]]) {
      await browser.forget()
      await browser.load(screen)
      assert.ok(await browser.titlesShown(), `at ${screen.width}px, no titles showed`)
      await browser.search('frieren')
      assert.ok(
        await browser.waitFor(`document.querySelector('.ab-results a[href="/anime/154587"]')`),
        'no result for Frieren',
      )
      await browser.evaluate(
        `document.querySelector('.ab-results a[href="/anime/154587"]').click(); true`,
      )
      assert.ok(
        await browser.waitFor(
          `document.querySelector('dialog.ab-card.is-landed .ab-synopsis .ab-more')`,
          10_000,
        ),
        `at ${screen.width}px, Frieren's card didn't open over Discover`,
      )
      await browser.animationsDone()
      await both(`${screen.width}px over Discover`)
    }
    await motion(SCREENS[0])
    await browser.evaluate(
      `document.querySelector('dialog.ab-card[open] .ab-synopsis-text').style.fontFamily = 'serif'; true`,
    )
    await both('390px in a fallback font')
    const paragraph =
      'Frieren walks on, year after year, through towns and seasons, remembering the friends she outlived and learning, too late and just in time, what their years together meant.'
    await stageDescription(Array(12).fill(paragraph).join('<br><br>'))
    const room = `(() => {
      const card = document.querySelector('dialog.ab-card[open]')
      card.style.overflowAnchor = 'none'
      const room = document.createElement('div')
      room.style.height = 2 * innerHeight + 'px'
      card.querySelector('.ab-details').after(room)
      return true
    })()`
    for (const screen of [PHONE, SCREENS[2]]) {
      await motion(screen)
      await browser.evaluate(room)
      await both(`${screen.width}px, a long synopsis`, 'start')
    }
    // On a phone, a long synopsis opening, the visitor scrolling up 400px 60 ms on: the card is
    // left where they scrolled it, not pulled back.
    await motion(PHONE)
    await browser.evaluate(room)
    const wheeled = await browser.evaluate<Frames>(FRAMES('center', { at: 60, act: 'wheel' }))
    const left = wheeled.frames[wheeled.acted!].scroll
    const pulled = wheeled.frames.slice(wheeled.acted!).find((frame) => frame.scroll > left + 1)
    if (pulled)
      seen.push(
        `280px, scrolled up as a long synopsis opened: pulled back from ${left}px to ${pulled.scroll}px at ${pulled.at} ms`,
      )
    // Under reduced motion, a long synopsis opening on a phone keeps the reader's place too: the
    // card doesn't scroll, and its first new line stays on the screen.
    await browser.forget()
    await browser.load({ ...PHONE, reduceMotion: true, url: at('/anime/154587') })
    assert.ok(
      await browser.waitFor(`document.querySelector('dialog.ab-card.is-landed')`, 10_000),
      'no card landed for Frieren',
    )
    await browser.animationsDone()
    await browser.evaluate(room)
    const still = await browser.evaluate<Frames>(FRAMES('center'))
    const line = still.frames.at(-1)!.top + still.before.height
    if (line < 0)
      seen.push(`280px, reduced motion, a long synopsis: the first new line went to ${line}px`)
    if (Math.abs(still.frames.at(-1)!.scroll - still.before.scroll) > 1)
      seen.push(
        `280px, reduced motion, a long synopsis: the card scrolled from ${still.before.scroll}px to ${still.frames.at(-1)!.scroll}px`,
      )
    await browser.rewriteAniList(null)
    for (const site of [false, true]) {
      await browser.forget()
      await browser.load({ ...SCREENS[0], reduceMotion: !site, url: at('/anime/154587') })
      if (site) await browser.evaluate(`document.documentElement.dataset.motion = 'reduce'; true`)
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card.is-landed')`, 10_000),
        'no card landed for Frieren',
      )
      await browser.animationsDone()
      const where = `390px, reduced motion ${site ? 'set on the site' : 'on the device'}`
      seen.push(
        ...judgeInstant(`${where}, Read more`, await browser.evaluate<Frames>(FRAMES('center'))),
      )
      seen.push(
        ...judgeInstant(`${where}, Show less`, await browser.evaluate<Frames>(FRAMES('center'))),
      )
    }
  } finally {
    await browser.rewriteAniList(null)
  }
  assert.deepEqual(seen, [], 'Read more and Show less moving wrongly')
})

// Watches the open card's synopsis from the next click on its button, a mouse's, a finger's or a
// key's, for 1500 ms (start it, press, then await window.watched). As the click ends, after the
// page's own handlers, in the same task: aria-expanded and the click's pointerType. Then frame by
// frame: the card's scroll, the text's height, full height and animations, the button's words,
// whether it is whole in the card's view on the screen, and whether it has focus. `before` is the
// synopsis as the watch begins.
const WATCH = `(() => {
  const card = document.querySelector('dialog.ab-card[open]')
  const text = card.querySelector('.ab-synopsis-text'), button = card.querySelector('.ab-synopsis .ab-more')
  const read = (at) => {
    const own = button.getBoundingClientRect(), view = card.getBoundingClientRect()
    return {
      at: Math.round(at),
      scroll: card.scrollTop,
      height: text.getBoundingClientRect().height,
      full: text.scrollHeight,
      moving: text.getAnimations().length,
      says: button.textContent,
      whole: own.top >= Math.max(view.top, 0) && own.bottom <= Math.min(view.bottom, innerHeight),
      focused: document.activeElement === button,
    }
  }
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
  const before = read(0)
  window.watched = new Promise((resolve) => {
    document.addEventListener('click', async (event) => {
      const start = performance.now()
      const clicked = { expanded: button.getAttribute('aria-expanded'), pointerType: event.pointerType }
      const frames = []
      while (performance.now() - start < 1500) {
        await frame()
        frames.push(read(performance.now() - start))
      }
      resolve({ before, clicked, frames })
    }, { once: true })
  })
  return true
})()`

type Watched = {
  before: Watch
  clicked: { expanded: string | null; pointerType: string | undefined }
  frames: Watch[]
}
type Watch = {
  at: number
  scroll: number
  height: number
  full: number
  moving: number
  says: string
  whole: boolean
  focused: boolean
}

test('Read more keeps the place of a reader who clicks or taps it, and brings its focused button into view for one who presses it with a key, once the text has opened', async () => {
  // Opening a long synopsis pushes its button far down. A reader who clicks or taps it is reading
  // the lines above it, so the card doesn't scroll: the rest opens below where they read, with
  // motion allowed or under reduced motion. A keyboard or screen reader user is on the button,
  // which now says Show less: left below the screen, their focus would be lost from sight (WCAG
  // 2.4.11). So once the text has opened, the button is brought into view, as near as it goes, in
  // the card: with motion allowed smoothly, over several frames, and not before the opening ends;
  // under reduced motion at once. Pressed for real, the mouse's and the finger's clicks and Enter's
  // and Space's, each with the button at the screen's foot, where a reader who has read the five
  // lines, or a key that has come to the button, leaves it: on a phone and at 1440px. Each press
  // also says the new state in aria-expanded on the press itself.
  const seen: string[] = []
  const paragraph =
    'Frieren walks on, year after year, through towns and seasons, remembering the friends she outlived and learning, too late and just in time, what their years together meant.'
  const PHONE = { width: 280, height: 653, phone: true }
  const centre = `(() => {
    const own = document.querySelector('dialog.ab-card[open] .ab-synopsis .ab-more').getBoundingClientRect()
    return { x: own.left + own.width / 2, y: own.top + own.height / 2 }
  })()`
  const presses = {
    mouse: async () => {
      const spot = await browser.evaluate<{ x: number; y: number }>(centre)
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...spot })
      for (const type of ['mousePressed', 'mouseReleased'])
        await browser.send('Input.dispatchMouseEvent', {
          type,
          ...spot,
          button: 'left',
          clickCount: 1,
        })
    },
    touch: async () => {
      const spot = await browser.evaluate<{ x: number; y: number }>(centre)
      await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [spot] })
      await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    },
    Enter: () => browser.press('Enter'),
    Space: () => browser.press('Space'),
  }
  const cases: [typeof PHONE | (typeof SCREENS)[number], boolean, keyof typeof presses][] = [
    [PHONE, false, 'mouse'],
    [PHONE, false, 'touch'],
    [PHONE, true, 'mouse'],
    [PHONE, false, 'Enter'],
    [PHONE, true, 'Space'],
    [SCREENS[2], false, 'Enter'],
    [SCREENS[2], true, 'Enter'],
  ]
  try {
    await stageDescription(Array(12).fill(paragraph).join('<br><br>'))
    for (const [screen, reduceMotion, by] of cases) {
      const where = `${screen.width}px${reduceMotion ? ', reduced motion' : ''}, ${by}`
      await browser.forget()
      await browser.load({ ...screen, reduceMotion, url: at('/anime/154587') })
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card.is-landed')`, 10_000),
        `${where}: no card landed for Frieren`,
      )
      await browser.animationsDone()
      const key = by === 'Enter' || by === 'Space'
      // The button at the screen's foot, focused for a key as Tab leaves it.
      await browser.evaluate(`(async () => {
        const button = document.querySelector('dialog.ab-card[open] .ab-synopsis .ab-more')
        ${key ? 'button.focus()' : ''}
        button.scrollIntoView({ block: 'end' })
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return true
      })()`)
      await browser.evaluate(WATCH)
      await presses[by]()
      const { before, clicked, frames } = await browser.evaluate<Watched>('window.watched')
      const end = frames.at(-1)!
      if (clicked.expanded !== 'true')
        seen.push(`${where}: aria-expanded said ${clicked.expanded} as the press ended`)
      if (clicked.pointerType !== (key ? '' : by))
        seen.push(`${where}: the click's pointerType was ${clicked.pointerType}`)
      if (end.says !== 'Show less' || Math.abs(end.height - end.full) > 1)
        seen.push(`${where}: didn't open (${end.says}, ${end.height}px of ${end.full}px)`)
      const opened = frames.findIndex((frame) => !frame.moving && frame.says === 'Show less')
      if (!key) {
        const moved = frames.find((frame) => Math.abs(frame.scroll - before.scroll) > 1)
        if (moved)
          seen.push(
            `${where}: the reader's place moved, the card scrolling from ${before.scroll}px to ${moved.scroll}px at ${moved.at} ms`,
          )
        continue
      }
      if (!before.whole) seen.push(`${where}: the button wasn't on the screen before the press`)
      if (!end.whole || !end.focused)
        seen.push(
          `${where}: once open, the focused button was ${end.whole ? '' : 'not '}whole on the screen and ${end.focused ? '' : 'not '}focused, the card at ${end.scroll}px`,
        )
      const early = frames.slice(0, opened).find((frame) => frame.scroll !== before.scroll)
      if (early)
        seen.push(
          `${where}: the card scrolled to ${early.scroll}px at ${early.at} ms, while opening`,
        )
      const after = frames.slice(opened)
      const into = after.findIndex((frame) => frame.whole)
      const between = after.filter(
        (frame) =>
          frame.scroll > Math.min(before.scroll, end.scroll) + 1 &&
          frame.scroll < Math.max(before.scroll, end.scroll) - 1,
      ).length
      if (into < 0 || (reduceMotion ? into > 1 || between > 0 : between < 3))
        seen.push(
          `${where}: the button came into view ${into < 0 ? 'never' : `${into} frames after the opening`}, through ${between} frames between, not ${reduceMotion ? 'at once' : 'smoothly'}`,
        )
    }
  } finally {
    await browser.rewriteAniList(null)
  }
  assert.deepEqual(seen, [], 'Read more went wrongly for the press it came from')
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
  // card's stops, from its close button: the My List row's Save, Want to try and Favorite, Open on
  // AniList (the Soon button is disabled), Watch trailer (Frieren has one), then the details'
  // buttons in reading order, Read more and Show spoiler tags, each with the card's focus ring,
  // 4px in brand hot.
  const STOPS = [
    'Close title card',
    'Save',
    'Want to try',
    'Favorite',
    'Open on AniList',
    'Watch trailer',
    'Read more',
    'Show spoiler tags',
  ]
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

// The open card's My List group as words: its role and name, and each button's name, its
// aria-pressed as written (none if missing) and " hot" where it is filled in brand hot
// (--hot-deep); and the group's own line, its role, whether it sits inside the card's dialog, and
// what it says.
const MY_LIST = `(() => {
  const card = document.querySelector('dialog.ab-card[open]')
  const group = card?.querySelector('.ab-sheet [role="group"]')
  const line = document.getElementById('ab-list-status')
  return {
    group: group ? (group.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent.trim()).join(' ') : 'none',
    buttons: group ? [...group.querySelectorAll('button')].map((button) => button.textContent.trim() + ' ' + (button.getAttribute('aria-pressed') ?? 'none') + (getComputedStyle(button).backgroundColor === 'rgb(214, 0, 42)' ? ' hot' : '')) : [],
    line: line ? { role: line.getAttribute('role'), 'in the card': card.contains(line), says: line.textContent.trim() } : 'none',
  }
})()`

// The list as this browser saved it, read back.
const SAVED_LIST = `JSON.parse(localStorage.getItem('anibeam:list:v1') ?? 'null')`

test('the card’s My List group offers Save, Want to try and Favorite, none pressed for a title not listed, and Save stays pressed after a reload', async () => {
  // The plan's PR 1, commit 6, as the visitor chose in the mockup (D3, T2): a group of its own
  // named "My List", each button with an explicit aria-pressed and a label that never changes,
  // filled in brand hot while pressed. Saving survives a reload (Phase 4's first done-when), and
  // the saved list holds the title's id, its status, its heart and the time, nothing of the title
  // itself (spec §5). The group's line, which a screen reader hears, sits inside the dialog, where
  // the page behind is inert, and is there before anything is pressed.
  await openFrieren(SCREENS[2])
  const fresh = await browser.evaluate(MY_LIST)
  await browser.evaluate(
    `[...document.querySelectorAll('dialog.ab-card[open] button')].find((button) => button.textContent.trim() === 'Save').click(); true`,
  )
  const pressed = await browser.evaluate(MY_LIST)
  await browser.load({ ...SCREENS[2], reduceMotion: true, url: at('/anime/154587') })
  assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000), 'no card after the reload')
  const reloaded = await browser.evaluate(MY_LIST)
  const saved = await browser.evaluate<Record<string, Record<string, unknown>> | null>(SAVED_LIST)
  const entry = saved?.['154587']
  assert.deepEqual(
    {
      fresh,
      pressed,
      reloaded,
      saved: saved && Object.keys(saved),
      entry: entry && {
        fields: Object.keys(entry).sort(),
        status: entry.status,
        favorite: entry.favorite,
        time: Math.abs(Date.now() - Number(entry.updatedAt)) < 60_000 ? 'now' : entry.updatedAt,
      },
    },
    {
      fresh: {
        group: 'My List',
        buttons: ['Save false', 'Want to try false', 'Favorite false'],
        line: { role: 'status', 'in the card': true, says: '' },
      },
      pressed: {
        group: 'My List',
        buttons: ['Save true hot', 'Want to try false', 'Favorite false'],
        line: { role: 'status', 'in the card': true, says: '' },
      },
      reloaded: {
        group: 'My List',
        buttons: ['Save true hot', 'Want to try false', 'Favorite false'],
        line: { role: 'status', 'in the card': true, says: '' },
      },
      saved: ['154587'],
      entry: {
        fields: ['favorite', 'status', 'updatedAt'],
        status: 'SAVED',
        favorite: false,
        time: 'now',
      },
    },
  )
})

test('Space and Enter press each My List button, Want to try moves a saved title and the line says so, and the heart saves a title not listed', async () => {
  // D1: one status per title, Save and Want to try as a pair: the other one moves the title, the
  // pressed one removes it. D2 (a): the heart on a title not listed puts it on as Saved, with the
  // heart, and removing the title takes the heart too. The line speaks for a move and a removal
  // only, never for a plain press, which the button's own state says.
  await openFrieren(SCREENS[0])
  const steps: string[] = []
  const note = async (did: string) => {
    const { buttons, line } = await browser.evaluate<{
      buttons: string[]
      line: { says: string }
    }>(MY_LIST)
    steps.push(`${did}: ${buttons.join(', ')}${line.says ? ` | ${line.says}` : ''}`)
  }
  const focus = (label: string) =>
    browser.evaluate(
      `[...document.querySelectorAll('dialog.ab-card[open] [role="group"] button')].find((button) => button.textContent.trim() === ${JSON.stringify(label)}).focus(); true`,
    )
  for (const label of ['Save', 'Want to try', 'Favorite']) {
    await focus(label)
    await browser.press('Space')
    await note(`Space on ${label}`)
    await browser.press('Enter')
    await note(`Enter on ${label}`)
  }
  for (const label of ['Want to try', 'Save', 'Favorite', 'Save']) {
    await focus(label)
    await browser.press('Enter')
    await note(`Enter on ${label}`)
  }
  assert.deepEqual(steps, [
    'Space on Save: Save true hot, Want to try false, Favorite false',
    'Enter on Save: Save false, Want to try false, Favorite false | Removed from My List',
    'Space on Want to try: Save false, Want to try true hot, Favorite false',
    'Enter on Want to try: Save false, Want to try false, Favorite false | Removed from My List',
    'Space on Favorite: Save true hot, Want to try false, Favorite true hot',
    'Enter on Favorite: Save true hot, Want to try false, Favorite false',
    'Enter on Want to try: Save false, Want to try true hot, Favorite false | Moved to Want to try',
    'Enter on Save: Save true hot, Want to try false, Favorite false | Moved to Saved',
    'Enter on Favorite: Save true hot, Want to try false, Favorite true hot',
    'Enter on Save: Save false, Want to try false, Favorite false | Removed from My List',
  ])
})

test('the My List line and the card’s status line, with Try again, are there at once, each saying its own', async () => {
  // The card's own status line (#ab-card-status) says why AniList holds up a newer answer, with
  // Try again; the My List line is a second one, so a press says its piece while the first keeps
  // saying its own. Frieren's answer is saved as an airing title's, aged past its 6 hours, and
  // AniList then answers 400, which the app doesn't try again, so Try again shows at once.
  await browser.forget()
  await browser.rewriteAniList(({ request, status, body }) => {
    if (request.variables.id !== 154587) return null
    body.data.Media.status = 'RELEASING'
    return { status, body }
  })
  try {
    await browser.load({ ...SCREENS[2], reduceMotion: true, url: at('/anime/154587') })
    assert.ok(await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000), 'no card')
    // The cache is saved at most once a second.
    await sleep(1500)
  } finally {
    await browser.rewriteAniList(null)
  }
  assert.ok(
    await browser.evaluate<boolean>(`(() => {
      const copy = JSON.parse(localStorage.getItem('anibeam:cache') ?? 'null')
      const title = copy?.clientState.queries.find((query) => query.queryKey[2]?.id === 154587)
      if (!title) return false
      title.state.dataUpdatedAt -= 7 * 60 * 60_000
      localStorage.setItem('anibeam:cache', JSON.stringify(copy))
      return true
    })()`),
    "Frieren's answer was never saved",
  )
  await browser.rewriteAniList(({ request }) =>
    request.variables.id === 154587
      ? { status: 400, body: { data: null, errors: [{ message: 'Bad Request.', status: 400 }] } }
      : null,
  )
  try {
    await browser.load({ ...SCREENS[2], reduceMotion: true, url: at('/anime/154587') })
    assert.ok(
      await browser.waitFor(`${STATUS}?.buttons.includes('Try again')`, 10_000),
      'no Try again in the card’s status line',
    )
    for (const label of ['Save', 'Want to try'])
      await browser.evaluate(
        `[...document.querySelectorAll('dialog.ab-card[open] [role="group"] button')].find((button) => button.textContent.trim() === ${JSON.stringify(label)}).click(); true`,
      )
    const lines = await browser.evaluate(`(() => {
      const card = document.querySelector('dialog.ab-card[open]')
      return [...card.querySelectorAll('[role="status"]')].map((line) => (line.id || 'unnamed') + ': ' + (line.textContent.trim() ? 'says something' : 'empty'))
    })()`)
    const list = await browser.evaluate<{ line: { says: string } }>(MY_LIST)
    assert.deepEqual(
      { lines, list: list.line.says, status: (await browser.evaluate(STATUS)) !== null },
      {
        lines: ['ab-list-status: says something', 'ab-card-status: says something'],
        list: 'Moved to Want to try',
        status: true,
      },
    )
  } finally {
    await browser.rewriteAniList(null)
  }
})

// How the open card's My List row and actions sit in its copy's column: how many buttons the row
// has, so a card with no row can't pass; each button or link that reaches past the column, and by
// how much, or whose label wraps onto a second line, taller than the 48px of one; and whether the
// card scrolls sideways.
const FITS = `(() => {
  const card = document.querySelector('dialog.ab-card[open]')
  const copy = card.querySelector('.ab-sheet-copy'), style = getComputedStyle(copy), box = copy.getBoundingClientRect()
  const left = box.left + parseFloat(style.paddingLeft), right = box.right - parseFloat(style.paddingRight)
  const past = [], wrapped = []
  for (const part of card.querySelectorAll('.ab-mylist button, .ab-row-actions > *')) {
    const r = part.getBoundingClientRect(), over = Math.max(left - r.left, r.right - right)
    if (over > 0.5) past.push(part.textContent.trim() + ' by ' + Math.round(over * 10) / 10 + 'px')
    if (r.height > 50) wrapped.push(part.textContent.trim() + ', ' + Math.round(r.height) + 'px tall')
  }
  const row = card.querySelectorAll('.ab-mylist button').length
  return { row, past, wrapped, sideways: card.scrollWidth > card.clientWidth }
})()`

// What hides any of the focused part (or `part`) or its focus ring: its ring (4px, 3px out) past
// the screen's edge, or, 2px in from each of its edges at the edge's middle, something else that a
// click there would reach, as a neighbour drawn over it would be, its ring hidden under it too.
const DRAWN_WHOLE = (part = 'document.activeElement') => `(() => {
  const part = ${part}, r = part.getBoundingClientRect(), ring = 7
  const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2
  const hid = []
  if (r.left - ring < 0 || r.top - ring < 0 || r.right + ring > innerWidth || r.bottom + ring > innerHeight)
    hid.push('its ring off the screen')
  const edges = { left: [r.left + 2, y], right: [r.right - 2, y], top: [x, r.top + 2], bottom: [x, r.bottom - 2] }
  for (const [edge, [px, py]] of Object.entries(edges)) {
    const hit = document.elementFromPoint(px, py)
    if (!part.contains(hit)) hid.push('its ' + edge + ' edge under ' + (hit?.textContent.trim() || hit?.className || hit?.tagName))
  }
  return hid
})()`

// Every part of the open card's sheet by its box on the screen, to tell whether a press moved one.
const PLACES = `[...document.querySelectorAll('dialog.ab-card[open] .ab-sheet *')].map((part) => { const r = part.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 10) / 10).join(' ') })`

test('from 280 to 1440px the My List row and the actions stay in the card’s column, each My List button shows whole with its ring, and a press moves nothing', async () => {
  // The plan's PR 1, commit 7. At 280px, a phone zoomed to 125% or more, the pair, Favorite and
  // the actions each fit the copy's column, each label on one line, and the card scrolls nowhere
  // sideways; so at 390px, 834px and 1440px. Save and Want to try share one border, so whichever
  // is focused, or pressed, is drawn over the other, and a focused one over a pressed one: its
  // edges are its own, and so is its focus ring beyond them, which stays on the screen. A press
  // changes a button's fill and nothing else, its label never changing, so no part of the card
  // moves. The row has its three buttons,
  // and Tab from the close button reaches Save, Want to try and Favorite in turn.
  const seen: Record<string, unknown> = {}
  const frames = `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`
  for (const screen of [{ width: 280, height: 653, phone: true }, ...SCREENS]) {
    await openFrieren(screen)
    const fits = await browser.evaluate(FITS)
    const hidden: string[] = []
    const moved: string[] = []
    const reached: string[] = []
    await browser.evaluate(`document.querySelector('dialog.ab-card[open] .ab-close').focus(); true`)
    for (const [n, label] of ['Save', 'Want to try', 'Favorite'].entries()) {
      await browser.press('Tab')
      await browser.evaluate(frames)
      // Tab lands on the button it names, or nothing here is pressed: the next stop could be a
      // link out of the site, and what it showed would be reported under a My List label.
      const stop = await browser.evaluate<string>(`document.activeElement.textContent.trim()`)
      if (stop !== label) {
        reached.push(`Tab ${n + 1} reached ${stop || 'nothing named'}, not ${label}`)
        continue
      }
      for (const hid of await browser.evaluate<string[]>(DRAWN_WHOLE()))
        hidden.push(`${label}, focused: ${hid}`)
      const before = await browser.evaluate<string[]>(PLACES)
      await browser.press('Enter')
      await browser.evaluate(frames)
      for (const hid of await browser.evaluate<string[]>(DRAWN_WHOLE()))
        hidden.push(`${label}, pressed: ${hid}`)
      if ((await browser.evaluate<string[]>(PLACES)).join() !== before.join()) moved.push(label)
    }
    // Want to try is pressed now. Shift+Tab back to Save: focused, it is drawn over the pressed
    // one. Pressed in turn, then left with neither focus nor a pointer on it, it is still drawn
    // over Want to try, which comes after it.
    await browser.press('Tab', true)
    await browser.press('Tab', true)
    await browser.evaluate(frames)
    const stop = await browser.evaluate<string>(`document.activeElement.textContent.trim()`)
    if (stop === 'Save') {
      for (const hid of await browser.evaluate<string[]>(DRAWN_WHOLE()))
        hidden.push(`Save, focused, Want to try pressed: ${hid}`)
      await browser.press('Enter')
      await browser.evaluate(`document.activeElement.blur(); true`)
      await browser.evaluate(frames)
      const save = `[...document.querySelectorAll('dialog.ab-card[open] .ab-mylist button')].find((button) => button.textContent.trim() === 'Save')`
      for (const hid of await browser.evaluate<string[]>(DRAWN_WHOLE(save)))
        hidden.push(`Save, pressed, not focused: ${hid}`)
    } else reached.push(`Shift+Tab twice reached ${stop || 'nothing named'}, not Save`)
    seen[`${screen.width}px`] = { fits, reached, hidden, moved }
  }
  const whole = {
    fits: { row: 3, past: [], wrapped: [], sideways: false },
    reached: [],
    hidden: [],
    moved: [],
  }
  assert.deepEqual(seen, { '280px': whole, '390px': whole, '834px': whole, '1440px': whole })
})

// The My List buttons in the open card of the tab `tab` (window, or another tab's window this one
// opened), each with its aria-pressed, or 'no card' while it has none open.
const PRESSED_IN = (tab: string) => `(() => {
  const group = ${tab}?.document.querySelector('dialog.ab-card[open] [role="group"]')
  return group ? [...group.querySelectorAll('button')].map((button) => button.textContent.trim() + ' ' + button.getAttribute('aria-pressed')).join(', ') : 'no card'
})()`
// Clicks the My List button labelled `label` in the open card of the tab `tab`.
const PRESS_IN = (tab: string, label: string) =>
  `[...${tab}.document.querySelectorAll('dialog.ab-card[open] [role="group"] button')].find((button) => button.textContent.trim() === ${JSON.stringify(label)}).click(), true`

test('hovered, Save is drawn over Want to try, pressed or not, its deeper shadow whole, with motion allowed or not', async () => {
  // Save and Want to try share one border (see the check above), and Want to try, after Save, is
  // drawn over it. Hovered, Save takes a deeper shadow, 6px right and down, as every button does.
  // With motion allowed it also lifts 3px, and a moved part is drawn over its neighbours; with
  // reduced motion it doesn't, and the shadow's right strip went under Want to try, unseen. So
  // hovered it is drawn over, as it is focused or pressed, either way, and over Want to try
  // pressed too: 4px right of its edge, in its shadow, the screen shows ink, not Want to try's
  // white or red. Read from a screenshot of that one pixel, at 1440px, where a pointer hovers.
  const seen: Record<string, string> = {}
  const SAVE = `[...document.querySelectorAll('dialog.ab-card[open] .ab-mylist button')].find((button) => button.textContent.trim() === 'Save').getBoundingClientRect()`
  for (const reduceMotion of [false, true]) {
    await browser.forget()
    await browser.load({ ...SCREENS[2], reduceMotion, url: at('/anime/154587') })
    assert.ok(
      await browser.waitFor(`/Frieren/.test(${CARD})`, 10_000),
      'no card opened for Frieren',
    )
    await browser.animationsDone()
    const middle = await browser.evaluate<{ x: number; y: number }>(
      `(() => { const r = ${SAVE}; return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 } })()`,
    )
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...middle })
    await browser.animationsDone()
    for (const wantPressed of [false, true]) {
      if (wantPressed) {
        await browser.evaluate(PRESS_IN('window', 'Want to try'))
        await browser.animationsDone()
      }
      const clip = await browser.evaluate<{ x: number; y: number; width: number; height: number }>(
        `(() => { const r = ${SAVE}; return { x: Math.round(r.right + 4 + scrollX), y: Math.round((r.top + r.bottom) / 2 + scrollY), width: 1, height: 1 } })()`,
      )
      const png = await browser.screenshot(clip)
      seen[
        `${reduceMotion ? 'reduced motion' : 'motion'}${wantPressed ? ', Want to try pressed' : ''}`
      ] = await browser.evaluate<string>(`(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const context = new OffscreenCanvas(1, 1).getContext('2d')
        context.drawImage(image, 0, 0)
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data
        return r + g + b < 120 ? 'ink' : 'rgb(' + [r, g, b].join(', ') + ')'
      })()`)
    }
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  }
  assert.deepEqual(seen, {
    motion: 'ink',
    'motion, Want to try pressed': 'ink',
    'reduced motion': 'ink',
    'reduced motion, Want to try pressed': 'ink',
  })
})

test('a press in one tab shows in another tab’s card for the same title, with no reload, and says nothing there', async () => {
  // The plan's PR 1, commit 8: two tabs of one browser, both on Frieren's address. The list store
  // hears the other tab's write (a storage event) and the open card's buttons follow it at once,
  // either way. The tab that didn't press says nothing of it: its line speaks for its own presses
  // only, and one that spoke of an earlier press (the second tab's "Moved to Want to try") empties,
  // so it never sits beside buttons that now show something else. The second tab is opened from
  // the first once Frieren's answer is saved, so it opens from the saved copy and asks AniList for
  // nothing (this browser answers only the first tab's requests).
  await openFrieren(SCREENS[2])
  assert.ok(
    await browser.waitFor(
      `localStorage.getItem('anibeam:cache')?.includes('"id":154587') ?? false`,
      5000,
    ),
    "Frieren's answer was never saved",
  )
  const other = 'window.__other'
  try {
    assert.ok(
      await browser.evaluate(`Boolean(${other} = window.open(location.href, '_blank'))`),
      'no second tab opened',
    )
    assert.ok(
      await browser.waitFor(`${PRESSED_IN(other)} !== 'no card'`, 10_000),
      'the second tab opened no card for Frieren',
    )
    const steps: string[] = []
    for (const [tab, label, watched] of [
      ['window', 'Save', other],
      [other, 'Favorite', 'window'],
      [other, 'Want to try', 'window'],
      ['window', 'Want to try', other],
    ]) {
      const line = `${watched}.document.getElementById('ab-list-status').textContent`
      const before = await browser.evaluate<string>(PRESSED_IN(watched))
      const said = await browser.evaluate<string>(line)
      await browser.evaluate(PRESS_IN(tab, label))
      const expected = await browser.evaluate<string>(PRESSED_IN(tab))
      const followed = await browser.waitFor(
        `${PRESSED_IN(watched)} === ${JSON.stringify(expected)}`,
        3000,
      )
      const now = await browser.evaluate<string>(line)
      steps.push(
        `${label} in ${tab === 'window' ? 'the first' : 'the second'} tab: ${
          followed
            ? 'followed'
            : `not followed (was ${before}, is ${await browser.evaluate(PRESSED_IN(watched))}, not ${expected})`
        }${now !== said ? `, the other tab's line now saying ${JSON.stringify(now)}` : ''}`,
      )
    }
    assert.deepEqual(steps, [
      'Save in the first tab: followed',
      'Favorite in the second tab: followed',
      'Want to try in the second tab: followed',
      `Want to try in the first tab: followed, the other tab's line now saying ""`,
    ])
    assert.equal(
      await browser.evaluate(PRESSED_IN('window')),
      'Save false, Want to try false, Favorite false',
      'the title, taken off in the last step, with its heart',
    )
  } finally {
    await browser.evaluate(`${other}?.close(), true`)
  }
})

// The two things a press can say that the buttons can't show, in the words of the plan's D14.
const FULL = 'My List is full (2,000)'
const KEPT = 'Couldn’t save on this device. Kept for this visit.'

// What the open card shows and says of the two notes: the parts that show one on the screen, as
// a sighted visitor reads them, and for the one shown, what's wrong with where it is (over the
// row's buttons or their shadow, over the actions, past the copy's column, its words cut off, its
// text under 4.5:1 on what it stands on, moving, or in a contrast theme not in its text color);
// the parts a screen reader reads that say one, by id or class (aria-hidden or not drawn, a part
// is never read); and the My List line.
const LIST_NOTE = `(() => {
  const card = document.querySelector('dialog.ab-card[open]')
  const words = ${JSON.stringify([FULL, KEPT])}
  const copy = card.querySelector('.ab-sheet-copy'), style = getComputedStyle(copy), box = copy.getBoundingClientRect()
  const left = box.left + parseFloat(style.paddingLeft), right = box.right - parseFloat(style.paddingRight)
  const rowFoot = Math.max(...[...card.querySelectorAll('.ab-mylist button')].map((button) => button.getBoundingClientRect().bottom)) + 3
  const actionsTop = card.querySelector('.ab-row-actions').getBoundingClientRect().top
  const text = (part) => part.textContent.trim()
  const saying = [...card.querySelectorAll('*')].filter((part) => words.includes(text(part)) && ![...part.children].some((child) => text(child) === text(part)))
  const shown = saying.filter((part) => { const r = part.getBoundingClientRect(); return r.width > 2 && r.height > 2 && part.checkVisibility({ opacityProperty: true, visibilityProperty: true }) })
  const heard = saying.filter((part) => !part.closest('[aria-hidden="true"]') && part.checkVisibility({ visibilityProperty: true }))
  const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const lum = (color) => { const [r, g, b] = color.match(/[\\d.]+/g).map(Number); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  const under = (part) => { for (let at = part; at; at = at.parentElement) { const bg = getComputedStyle(at).backgroundColor; if (!/rgba\\(.*, 0\\)$/.test(bg) && bg !== 'transparent') return bg } return 'rgb(255, 255, 255)' }
  const probe = document.body.appendChild(document.createElement('i'))
  probe.style.color = 'CanvasText'
  const canvasText = getComputedStyle(probe).color
  probe.remove()
  const placed = shown.flatMap((part) => {
    const r = part.getBoundingClientRect(), wrong = []
    if (r.top < rowFoot - 0.5) wrong.push('over the row by ' + Math.round(rowFoot - r.top) + 'px')
    if (r.bottom > actionsTop + 0.5) wrong.push('over the actions by ' + Math.round(r.bottom - actionsTop) + 'px')
    if (r.left < left - 0.5 || r.right > right + 0.5) wrong.push('past the column')
    if (part.scrollWidth > part.clientWidth + 1 || part.scrollHeight > part.clientHeight + 1) wrong.push('cut off')
    const contrast = ratio(getComputedStyle(part).color, under(part))
    if (contrast < 4.5) wrong.push('text at ' + Math.round(contrast * 10) / 10 + ':1')
    if (part.getAnimations({ subtree: true }).length > 0) wrong.push('moving')
    if (matchMedia('(forced-colors: active)').matches && getComputedStyle(part).color !== canvasText) wrong.push('not in the theme’s text color')
    return wrong
  })
  return {
    shown: shown.map(text),
    placed,
    heard: heard.map((part) => part.id || String(part.className)),
    says: text(document.getElementById('ab-list-status')),
  }
})()`

// Notes each part of the open card's sheet by its box, for MOVED.
const BOXES = `(() => {
  window.__boxes = new Map([...document.querySelectorAll('dialog.ab-card[open] .ab-sheet *')].map((part) => [part, JSON.stringify(part.getBoundingClientRect())]))
  return true
})()`
// The parts BOXES noted that have moved or changed size since, but for a note's own (see
// LIST_NOTE): a note that pushed another part would move that part.
const MOVED = `(() => {
  const words = ${JSON.stringify([FULL, KEPT])}
  const notes = [...document.querySelectorAll('dialog.ab-card[open] *')].filter((part) => words.includes(part.textContent.trim()))
  return [...window.__boxes].filter(([part, box]) => !notes.some((note) => note.contains(part)) && (!part.isConnected || JSON.stringify(part.getBoundingClientRect()) !== box)).map(([part]) => part.localName + '.' + String(part.className).split(' ')[0])
})()`

test('a full list and a refused save show their note under the My List row until the next press, moving nothing, and a screen reader hears each once', async () => {
  // The review found that "My List is full" and "Couldn't save on this device" were heard by a
  // screen reader only: nothing changes on the screen for the first, and the second looks saved.
  // The user chose a short line under the row in those two cases only, as a sighted visitor's
  // note of them. It sits under the row's buttons and their shadow, above the card's actions,
  // inside the copy's column, its words whole and in ink on the paper, from 280 to 1440px; it
  // moves nothing as it comes or goes (the room is kept for it), and nothing in it moves, under
  // reduced motion as here. A screen reader hears it from the My List line alone. The next
  // press in the row takes it away, as a move here does. The list is staged full with 2,000
  // other titles, saved as another tab would; then those are taken off and the list's key
  // refused by storage, as a browser that can't save would.
  const seen: Record<string, unknown> = {}
  const frames = `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`
  const listOf = (entry: string) =>
    `(() => { const list = {}; for (let id = 1; id <= 2000; id++) list[id] = ${entry}; localStorage.setItem('anibeam:list:v1', JSON.stringify(list)); return true })()`
  const refuse = `(() => { const set = Storage.prototype.setItem; window.__set = set; Storage.prototype.setItem = function (key, value) { if (key === 'anibeam:list:v1') throw new Error('refused'); return set.call(this, key, value) }; return true })()`
  const press = async (label: string) => {
    await browser.evaluate(BOXES)
    await browser.evaluate(PRESS_IN('window', label))
    await browser.evaluate(frames)
    return {
      buttons: await browser.evaluate<string>(PRESSED_IN('window')),
      ...(await browser.evaluate<object>(LIST_NOTE)),
      moved: await browser.evaluate<string[]>(MOVED),
    }
  }
  for (const screen of [{ width: 280, height: 653, phone: true }, ...SCREENS]) {
    await openFrieren(screen)
    const fresh = await browser.evaluate(LIST_NOTE)
    await browser.evaluate(listOf(`{ status: 'SAVED', favorite: false, updatedAt: 1 }`))
    const full = await press('Save')
    await browser.evaluate(
      listOf(`{ status: 'SAVED', favorite: false, updatedAt: 2, deleted: true }`),
    )
    await browser.evaluate(refuse)
    let kept = {}
    const contrast: string[] = []
    try {
      kept = await press('Save')
      // In a contrast theme, light or dark, the note takes the theme's text color.
      if (!screen.phone)
        for (const scheme of ['light', 'dark']) {
          await browser.send('Emulation.setEmulatedMedia', {
            features: [
              { name: 'prefers-reduced-motion', value: 'reduce' },
              { name: 'forced-colors', value: 'active' },
              { name: 'prefers-color-scheme', value: scheme },
            ],
          })
          const { shown, placed } = await browser.evaluate<{ shown: string[]; placed: string[] }>(
            LIST_NOTE,
          )
          if (shown.join() !== KEPT || placed.length > 0)
            contrast.push(`${scheme}: ${shown.join() || 'no note'} ${placed.join(', ')}`)
        }
    } finally {
      await browser.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      })
      await browser.evaluate(`window.__set && (Storage.prototype.setItem = window.__set), true`)
    }
    await browser.evaluate(frames)
    const after = await press('Want to try')
    seen[`${screen.width}px`] = { fresh, full, kept, contrast, after }
  }
  const nothing = { shown: [], placed: [], heard: [], says: '' }
  const expected = {
    fresh: nothing,
    full: {
      buttons: 'Save false, Want to try false, Favorite false',
      shown: [FULL],
      placed: [],
      heard: ['ab-list-status'],
      says: FULL,
      moved: [],
    },
    kept: {
      buttons: 'Save true, Want to try false, Favorite false',
      shown: [KEPT],
      placed: [],
      heard: ['ab-list-status'],
      says: KEPT,
      moved: [],
    },
    contrast: [],
    after: {
      buttons: 'Save false, Want to try true, Favorite false',
      ...nothing,
      says: 'Moved to Want to try',
      moved: [],
    },
  }
  assert.deepEqual(seen, {
    '280px': expected,
    '390px': expected,
    '834px': expected,
    '1440px': expected,
  })
})

test('in a contrast theme, a pressed My List button takes the theme’s colors for a selected thing and a ring inside, and one not pressed doesn’t', async () => {
  // A contrast theme paints every button alike, so the brand hot fill of a pressed one would go:
  // a pressed one takes the theme's colors for something selected, as an open Read more does, in
  // a light palette and a dark one, with a ring inside its border in the theme's text color (a
  // theme drops every shadow it paints itself, so a pressed one keeps its own). Saved with the
  // heart, Save and Favorite are pressed, Want to try isn't.
  const seen: string[] = []
  await openFrieren(SCREENS[2])
  for (const label of ['Save', 'Favorite']) await browser.evaluate(PRESS_IN('window', label))
  try {
    for (const scheme of ['light', 'dark']) {
      await browser.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-color-scheme', value: scheme },
        ],
      })
      const buttons = await browser.evaluate<string[]>(`(() => {
        const probe = document.body.appendChild(document.createElement('i'))
        probe.style.backgroundColor = 'SelectedItem'
        const selected = getComputedStyle(probe).backgroundColor
        probe.remove()
        return [...document.querySelectorAll('dialog.ab-card[open] [role="group"] button')].map((button) =>
          button.textContent.trim() + ' ' + button.getAttribute('aria-pressed') + ': ' + (getComputedStyle(button).backgroundColor === selected ? 'selected' : 'not selected') + (getComputedStyle(button).boxShadow !== 'none' ? ', ringed' : ''))
      })()`)
      const expected = [
        'Save true: selected, ringed',
        'Want to try false: not selected',
        'Favorite true: selected, ringed',
      ]
      if (JSON.stringify(buttons) !== JSON.stringify(expected))
        seen.push(`${scheme}: ${buttons.join(', ')}`)
    }
  } finally {
    await browser.send('Emulation.setEmulatedMedia', { features: [] })
  }
  assert.deepEqual(
    seen,
    [],
    'My List buttons whose look, in a contrast theme, says the wrong thing',
  )
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

test('an open button shows it is open by its border too, not by its fill alone', async () => {
  // Show spoiler tags says the same open or closed, and its open fill, the title's, can be as
  // little as 1.5:1 on the closed button's white: told by that alone, the state is told by color
  // alone (WCAG 1.4.1). Open, its ink border doubles inside it. Frieren's button is drawn
  // closed and open with the title's fill made white, and the ink in each counted: open, it has
  // a fifth more at least (the doubled border adds nearly half).
  const seen: string[] = []
  const ink = async () => {
    const clip = await browser.evaluate<{
      x: number
      y: number
      width: number
      height: number
    }>(`(() => {
      const button = document.querySelector('dialog.ab-card[open] .ab-tag-set .ab-more')
      button.style.setProperty('--anime-accent', '#fff')
      button.scrollIntoView({ block: 'center' })
      const box = button.getBoundingClientRect()
      return { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height }
    })()`)
    const png = await browser.screenshot(clip)
    return browser.evaluate<number>(`(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const { data } = context.getImageData(0, 0, image.width, image.height)
      let dark = 0
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 3 * 96) dark++
      return dark
    })()`)
  }
  for (const screen of [SCREENS[0], SCREENS[2]]) {
    await openFrieren(screen)
    const closed = await ink()
    await browser.evaluate(`(async () => {
      document.querySelector('dialog.ab-card[open] .ab-tag-set .ab-more').click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return true
    })()`)
    const open = await ink()
    if (open < closed * 1.2)
      seen.push(`${screen.width}px: ${open} ink pixels open, ${closed} closed, with a white fill`)
  }
  assert.deepEqual(seen, [], 'Show spoiler tags, open, told from closed only by its fill')
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
        [
          'Save',
          'Want to try',
          'Favorite',
          'Open on AniList',
          'Watch trailer',
          'Read more',
          'Show spoiler tags',
        ],
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
        [
          'Save',
          'Want to try',
          'Favorite',
          'Open on AniList',
          'Watch trailer',
          'Read more',
          'Show spoiler tags',
          'Try again',
        ],
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
