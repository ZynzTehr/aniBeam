// The title card as a title page (spec §3A, plan PRs 12 and 13): its layout, from a phone to a
// wide screen. The titles come from the recordings; a check that needs something particular of a
// title, such as no banner, stages it with rewriteAniList on Frieren's answer.
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { BASE_URL, Browser } from './browser.ts'

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

/** Opens Frieren's card at its address, under reduced motion, and waits until it has landed. */
async function openFrieren(screen: (typeof SCREENS)[number]) {
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

// Once the open card's banner, if it has one, has loaded or failed, and its error or load event
// has been handled (two frames on).
const BANNER_SETTLED = `(async () => {
  const banner = document.querySelector('dialog.ab-card[open] .ab-band img')
  if (banner) await banner.decode().catch(() => {})
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return true
})()`

test('the banner band crowns the card in an ink frame, the same size with a banner, without one and with a broken one', async () => {
  // Spec §3A: the banner across the top, clamp(200px, 25vw, 420px) tall on a desktop, a short
  // strip on a phone (19:4, the banner's own shape, where the card stacks, to 820px), cropped to
  // fill. It sits flush inside the sheet's ink border, inked along its foot, with the cover and
  // the text below it. With no banner, or one that fails to load, it keeps its size, so the card
  // looks the same either way and nothing moves as a banner loads or fails; a failed one hides,
  // rather than show Chrome's broken-image icon.
  const seen: string[] = []
  try {
    for (const banner of Object.keys(BANNERS) as Banner[]) {
      await stage(banner)
      for (const screen of SCREENS) {
        await openFrieren(screen)
        await browser.evaluate(BANNER_SETTLED)
        const band = await browser.evaluate<Record<string, unknown> | null>(`(() => {
          const card = document.querySelector('dialog.ab-card[open]')
          const band = card.querySelector('.ab-sheet > .ab-band')
          if (!band) return null
          const sheet = card.querySelector('.ab-sheet').getBoundingClientRect(), box = band.getBoundingClientRect()
          const style = getComputedStyle(band), img = band.querySelector('img')
          const px = (n) => Math.round(n * 10) / 10
          // Phones and tablets up to 820px stack the card: there the band is a 19:4 strip.
          const height = innerWidth <= 820 ? box.width * 4 / 19 : Math.min(420, Math.max(200, innerWidth / 4))
          const shown = img && img.checkVisibility({ visibilityProperty: true })
          const inside = { top: box.top, left: box.left, right: box.right, bottom: box.bottom - parseFloat(style.borderBottomWidth) }
          const fills = img && ['top', 'left', 'right', 'bottom'].every((side) => Math.abs(img.getBoundingClientRect()[side] - inside[side]) < 1)
          return {
            'inside the sheet border': px(box.top - sheet.top) + ', ' + px(box.left - sheet.left) + ', ' + px(sheet.right - box.right),
            height: Math.abs(box.height - height) < 1 ? 'as it should be' : px(box.height) + 'px, not ' + px(height) + 'px',
            'ink line': style.borderBottomStyle + ' ' + style.borderBottomWidth + ' ' + style.borderBottomColor,
            banner: !img ? 'none' : img.hasAttribute('data-broken') ? (shown ? 'broken, shown' : 'broken, hidden') : !img.complete || !img.naturalWidth ? 'not loaded' : shown && fills && getComputedStyle(img).objectFit === 'cover' ? 'fills the band' : 'shown, not filling the band',
            'the cover': card.querySelector('.ab-sheet-art img').getBoundingClientRect().top >= box.bottom ? 'below it' : 'under it',
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

test('the band and the cover stay put from the card’s first frame to the banner’s arrival, and the card opens without waiting for it', async () => {
  // The banner is large (123 to 358 KB) and comes after the card has opened: the band must not
  // wait for it to show, nor change size as it lands. Frame by frame from the card's first, the
  // band's box and the cover's place stay the same, and the card shows before the banner has
  // come. Its address is made new for this check, so no copy saved earlier can bring it at once.
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
      { boxes: string[]; before: number } | 'no band' | null
    >(`new Promise((resolve) => {
      const boxes = [], until = performance.now() + 15000
      let before = 0, after = 0
      requestAnimationFrame(function frame() {
        const card = document.querySelector('dialog.ab-card[open]')
        const band = card?.querySelector('.ab-band'), banner = band?.querySelector('img')
        if (performance.now() > until) return resolve(boxes.length ? null : 'no band')
        if (band) {
          const b = band.getBoundingClientRect(), c = card.querySelector('.ab-sheet-art img').getBoundingClientRect()
          const box = [b.top, b.left, b.width, b.height, c.top, c.left].map(Math.round).join(' ')
          if (boxes.at(-1) !== box) boxes.push(box)
          if (banner?.complete && banner.naturalWidth) after++
          else before++
          if (after > 5) return resolve({ boxes, before })
        }
        requestAnimationFrame(frame)
      })
    })`)
    assert.notEqual(frames, 'no band', 'the card has no banner band')
    assert.ok(frames && frames !== 'no band', 'the banner never arrived')
    assert.ok(frames.before > 0, 'the card waited for its banner before it showed')
    assert.equal(frames.boxes.length, 1, `the band or the cover moved: ${frames.boxes.join(' → ')}`)
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
  // dark dots both plain to see.
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
        if (lighter < 5) seen.push(`${where}: ${lighter}% speed lines, lighter than its color`)
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
