// The trailer (spec §3A, plan PR 15): "Watch trailer" in a title's card plays its YouTube trailer in
// a dialog over the card, and nothing loads from YouTube or Google before that press (spec §5).
// Every browser's Chrome here starts unable to resolve YouTube's and Google's addresses (see
// chromeArgs), so the checks see what the page asks for, from the page and the frames in it, and
// nothing reaches them: the embed's frame shows Chrome's error page in the video's place.
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { BASE_URL, Browser, GOOGLE } from './browser.ts'

let browser: Browser
// Every request the page made, frames and all, from the browser's start (see watchRequests).
let requests: { url: string; error?: string }[]
before(async () => {
  browser = await Browser.open()
  requests = await browser.watchRequests()
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

const PHONE = { width: 390, height: 844, phone: true }
const DESKTOP = { width: 1440, height: 900, phone: false }
type Screen = typeof PHONE | typeof DESKTOP
const at = (path: string) => new URL(path, BASE_URL).href

// Frieren, whose recorded trailer is on YouTube, and its third season, in the same search, which
// has none.
const FRIEREN = 154587
const THIRD_SEASON = 209939
const EMBED = 'https://www.youtube-nocookie.com/embed/tR8YH0G67Rk?rel=0&playsinline=1'

/** The requests to YouTube's or Google's servers the page has made since `from`. */
const toGoogle = (from = 0) =>
  requests.slice(from).filter(({ url }) => {
    const { hostname } = new URL(url)
    return GOOGLE.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  })
/** Their addresses. */
const fromGoogle = (from = 0) => toGoogle(from).map(({ url }) => url)

// What has the keyboard's focus, in words: a control's name, or where focus is if not on one.
const FOCUS = `(() => {
  const part = document.activeElement
  if (!part || part === document.body) return 'the page'
  if (part.localName === 'iframe') return 'the video'
  if (part.localName === 'dialog') return part.className.split(' ')[0]
  return (part.getAttribute('aria-label') ?? part.textContent).replace(/\\s+/g, ' ').trim()
})()`

const TRAILER = `document.querySelector('dialog.ab-trailer[open]')`
const CARD = `document.querySelector('dialog.ab-card[open]')`

/**
 * Searches "frieren" and opens title `id`'s card from the results with the keyboard, as a visitor
 * would, and waits until it has landed. Nothing is saved first.
 */
async function openFromSearch(screen: Screen, id: number, reduceMotion = true) {
  await browser.forget()
  await browser.load({ ...screen, reduceMotion })
  assert.ok(await browser.titlesShown(), `at ${screen.width}px, no titles showed`)
  await browser.search('frieren')
  const link = `document.querySelector('.ab-results a[href="/anime/${id}"]')`
  assert.ok(await browser.waitFor(link, 10_000), `at ${screen.width}px, no result for ${id}`)
  await browser.evaluate(`${link}.focus(); true`)
  await browser.press('Enter')
  assert.ok(
    await browser.waitFor(`document.querySelector('dialog.ab-card.is-landed')`, 10_000),
    `at ${screen.width}px, ${id}'s card didn't open`,
  )
  await browser.animationsDone()
}

/** Presses Watch trailer with the keyboard, and waits until the trailer has opened. */
async function watchTrailer() {
  await browser.evaluate(
    `[...document.querySelectorAll('dialog.ab-card[open] button')].find((button) => button.textContent.trim() === 'Watch trailer').focus(); true`,
  )
  await browser.press('Enter')
  assert.ok(await browser.waitFor(TRAILER, 5_000), 'Watch trailer opened no trailer')
  await browser.animationsDone()
}

/**
 * Presses the mouse at a point on the screen and lets it go there, as a mouse does: the `count`th
 * click of a run, so 2 is a double-click's second.
 */
async function click(x: number, y: number, count = 1) {
  const point = { x, y, button: 'left', clickCount: count }
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point })
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point })
}

/** Where on the screen the middle of what `part` finds is, in the page's pixels. */
const middleOf = (part: string) =>
  browser.evaluate<{ x: number; y: number }>(`(() => {
    const r = ${part}.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)

const WATCH = `[...document.querySelectorAll('dialog.ab-card[open] button')].find((button) => button.textContent.trim() === 'Watch trailer')`

// The card's buttons and links in its row of actions, as words.
const ACTIONS = `[...document.querySelectorAll('dialog.ab-card[open] .ab-row-actions > *')].map((part) => part.textContent.replace(/\\s+/g, ' ').trim() + (part.disabled ? ' (disabled)' : ''))`

test('a card offers “Watch trailer” last of its actions only when its title has a YouTube trailer, and opening it loads nothing from YouTube or Google', async () => {
  // Spec §5: YouTube loads only when a trailer is played. The lists carry where each trailer is
  // (its id, never its thumbnail), so the card knows at once whether to offer it: a title with none
  // has no button at all, not one disabled. Opening either asks YouTube and Google for nothing,
  // and puts no frame in the page.
  const seen: Record<string, unknown> = {}
  for (const screen of [PHONE, DESKTOP]) {
    for (const id of [FRIEREN, THIRD_SEASON]) {
      const from = requests.length
      await openFromSearch(screen, id)
      seen[`${screen.width}px, ${id}`] = {
        actions: await browser.evaluate(ACTIONS),
        'from YouTube or Google': fromGoogle(from),
        frames: await browser.evaluate(`document.querySelectorAll('iframe').length`),
      }
    }
  }
  const expected = (trailer: boolean) => ({
    actions: [
      'Open on AniList',
      'Chat about it Soon (disabled)',
      ...(trailer ? ['Watch trailer'] : []),
    ],
    'from YouTube or Google': [],
    frames: 0,
  })
  assert.deepEqual(seen, {
    '390px, 154587': expected(true),
    '390px, 209939': expected(false),
    '1440px, 154587': expected(true),
    '1440px, 209939': expected(false),
  })
})

test('a title whose trailer AniBeam can’t play, on another site or with an id that isn’t YouTube’s, has no “Watch trailer”', async () => {
  // Only a YouTube trailer with an 11-character id counts (see trailerOf). Every trailer in the
  // recordings is one, so here AniList's answer to the search is changed: the third season's
  // trailer is on Dailymotion, and Frieren's id is no YouTube id. Neither card offers the button,
  // and opening either puts no frame in the page and asks YouTube and Google for nothing.
  const trailers: Record<number, { id: string; site: string }> = {
    [THIRD_SEASON]: { id: 'x2abcde', site: 'dailymotion' },
    [FRIEREN]: { id: 'tR8YH0G67Rk&list=1', site: 'youtube' },
  }
  await browser.rewriteAniList(({ request, status, body }) => {
    if (request.variables.search !== 'frieren') return null
    for (const media of body.data.Page.media)
      if (trailers[media.id]) media.trailer = trailers[media.id]
    return { status, body }
  })
  const seen: Record<string, unknown> = {}
  try {
    for (const id of [FRIEREN, THIRD_SEASON]) {
      const from = requests.length
      await openFromSearch(DESKTOP, id)
      seen[id] = {
        actions: await browser.evaluate(ACTIONS),
        'from YouTube or Google': fromGoogle(from),
        frames: await browser.evaluate(`document.querySelectorAll('iframe').length`),
      }
    }
  } finally {
    await browser.rewriteAniList(null)
  }
  const none = {
    actions: ['Open on AniList', 'Chat about it Soon (disabled)'],
    'from YouTube or Google': [],
    frames: 0,
  }
  assert.deepEqual(seen, { [FRIEREN]: none, [THIRD_SEASON]: none })
})

// The open trailer, as a check reads it: where focus is, its links and frame as the page made
// them, and their boxes on the screen.
const READ_TRAILER = `(() => {
  const trailer = ${TRAILER}
  const frame = trailer.querySelector('iframe')
  const link = [...trailer.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Open on YouTube')
  const close = [...trailer.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close')
  const box = (part) => { const r = part.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
  return {
    modal: trailer.matches(':modal'),
    'over the card': trailer.parentElement === ${CARD},
    focus: ${FOCUS},
    name: trailer.getAttribute('aria-labelledby') && document.getElementById(trailer.getAttribute('aria-labelledby')).textContent.replace(/\\s+/g, ' ').trim(),
    link: link && { href: link.href, target: link.target, rel: link.rel },
    frame: frame && { src: frame.src, referrerPolicy: frame.referrerPolicy, sandbox: frame.hasAttribute('sandbox'), allow: frame.allow, title: frame.title },
    boxes: { frame: box(frame), close: close && box(close), link: link && box(link), panel: box(trailer.querySelector('.ab-trailer-panel')) },
  }
})()`

type Box = {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}
const overlap = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

test('Watch trailer plays the trailer from youtube-nocookie.com in a dialog over the card, Close first and outside the video, with Open on YouTube, and asks YouTube for nothing else', async () => {
  // Spec §3A: the trailer mounts in a native dialog only after the press, from YouTube's
  // privacy-enhanced address, playing at once (motion is allowed here) and in the page on an
  // iPhone. The site's origin goes as the referrer, which YouTube asks of an embed, and there is
  // no sandbox, which would keep the player from working. Close takes the keyboard's focus first,
  // outside the video, where Tab and Esc are still the site's; "Open on YouTube" is always there,
  // to the trailer's page, in a new tab. The panel fits the screen, its video 16:9, and stays put
  // as the video's frame loads (or fails: here YouTube can't be reached).
  const seen: Record<string, unknown> = {}
  for (const screen of [PHONE, DESKTOP]) {
    await openFromSearch(screen, FRIEREN, false)
    const from = requests.length
    await watchTrailer()
    const first = await browser.evaluate<Record<string, any>>(READ_TRAILER)
    await browser.waitFor('false', 1_000)
    const later = await browser.evaluate<Record<string, any>>(READ_TRAILER)
    const { boxes } = first
    const fits = (part: Box) =>
      part.top >= 0 &&
      part.left >= 0 &&
      part.right <= screen.width + 0.5 &&
      part.bottom <= screen.height + 0.5
    seen[`${screen.width}px`] = {
      modal: first.modal,
      'over the card': first['over the card'],
      card: await browser.evaluate(`Boolean(${CARD})`),
      focus: first.focus,
      name: first.name,
      link: first.link,
      frame: first.frame,
      'from YouTube or Google': fromGoogle(from),
      // Chrome can't resolve YouTube's address here (see chromeArgs), so the request went nowhere.
      reached: toGoogle(from).map(({ error }) => error ?? 'no error'),
      'fits the screen': [boxes.panel, boxes.close, boxes.link].every(fits),
      'video 16:9': Math.abs(boxes.frame.width / boxes.frame.height - 16 / 9) < 0.01,
      'video at least': boxes.frame.width >= Math.min(screen.width - 64, 1000),
      'Close and the link outside the video':
        !overlap(boxes.close, boxes.frame) && !overlap(boxes.link, boxes.frame),
      'still a second later': JSON.stringify(later.boxes) === JSON.stringify(boxes),
    }
  }
  const expected = {
    modal: true,
    'over the card': true,
    card: true,
    focus: 'Close',
    name: 'Trailer Frieren: Beyond Journey’s End',
    link: {
      href: 'https://www.youtube.com/watch?v=tR8YH0G67Rk',
      target: '_blank',
      rel: 'noopener',
    },
    frame: {
      src: `${EMBED}&autoplay=1`,
      referrerPolicy: 'strict-origin-when-cross-origin',
      sandbox: false,
      allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture',
      title: 'Trailer: Frieren: Beyond Journey’s End',
    },
    'from YouTube or Google': [`${EMBED}&autoplay=1`],
    reached: ['net::ERR_NAME_NOT_RESOLVED'],
    'fits the screen': true,
    'video 16:9': true,
    'video at least': true,
    'Close and the link outside the video': true,
    'still a second later': true,
  }
  assert.deepEqual(seen, { '390px': expected, '1440px': expected })
})

test('on a phone on its side, the trailer’s panel fits the short screen and its title keeps room to be read', async () => {
  // The panel is as wide as the screen's height lets its 16:9 video be, so on a short, wide screen
  // it is narrow though the screen isn't: the bar lays itself out by the panel's width, giving the
  // title a row of its own when Close and Open on YouTube would leave it too little, and its label
  // never runs under them. Sizes: iPhone Pro Max and iPhone 15 on their sides with Safari's bars,
  // and an iPhone SE.
  const seen: Record<string, unknown> = {}
  for (const [width, height] of [
    [932, 340],
    [844, 340],
    [844, 390],
    [667, 375],
  ]) {
    await openFromSearch({ width, height, phone: true }, FRIEREN)
    await watchTrailer()
    seen[`${width}x${height}`] = await browser.evaluate(`(() => {
      const trailer = ${TRAILER}
      const box = (part) => part.getBoundingClientRect()
      const panel = box(trailer.querySelector('.ab-trailer-panel'))
      const title = trailer.querySelector('.ab-trailer-title')
      const label = title.querySelector('small')
      const controls = [...trailer.querySelectorAll('.ab-trailer-bar > a, .ab-trailer-bar > button')].map(box)
      const t = box(title)
      return {
        'panel fits': panel.top >= 0 && panel.left >= 0 && panel.right <= ${width} + 0.5 && panel.bottom <= ${height} + 0.5,
        'title at least 120px': t.width >= 120,
        'label shown whole': label.scrollWidth <= label.clientWidth,
        'title clear of Close and the link': controls.every((c) => c.right <= t.left || t.right <= c.left || c.bottom <= t.top || t.bottom <= c.top),
      }
    })()`)
  }
  const fits = {
    'panel fits': true,
    'title at least 120px': true,
    'label shown whole': true,
    'title clear of Close and the link': true,
  }
  assert.deepEqual(seen, { '932x340': fits, '844x340': fits, '844x390': fits, '667x375': fits })
})

test('with reduced motion asked for, on the device or with the site’s switch, the trailer waits to be played, and fades in and out', async () => {
  // Spec §3J: the trailer doesn't autoplay under reduced motion. The dialog fades in over 150 ms,
  // and out as it closes, as the card does, in place of the panel's pop with motion allowed.
  const seen: Record<string, unknown> = {}
  // The properties each of the trailer's running animations changes, as it opens and as it closes.
  const ANIMATED = `[...new Set(${TRAILER}.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').flatMap((a) => a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !['offset', 'computedOffset', 'easing', 'composite'].includes(p)))))].sort()`
  for (const [asked, device, site] of [
    ['motion allowed', false, false],
    ['the device', true, false],
    ['the site', false, true],
  ] as const) {
    await openFromSearch(DESKTOP, FRIEREN, device)
    if (site) {
      // The footer's switch, which the card covers, saves the choice for later visits.
      await browser.evaluate(`localStorage.setItem('anibeam:motion', 'reduce'); true`)
      await browser.load({ ...DESKTOP, url: at(`/`) })
      await browser.search('frieren')
      await browser.waitFor(`document.querySelector('.ab-results a[href="/anime/${FRIEREN}"]')`)
      await browser.evaluate(
        `document.querySelector('.ab-results a[href="/anime/${FRIEREN}"]').focus(); true`,
      )
      await browser.press('Enter')
      await browser.waitFor(`document.querySelector('dialog.ab-card.is-landed')`, 10_000)
    }
    await browser.evaluate(
      `[...document.querySelectorAll('dialog.ab-card[open] button')].find((button) => button.textContent.trim() === 'Watch trailer').focus(); true`,
    )
    await browser.press('Enter')
    await browser.waitFor(TRAILER, 5_000)
    const opening = await browser.evaluate(ANIMATED)
    const src = await browser.evaluate(`${TRAILER}.querySelector('iframe').src`)
    await browser.animationsDone()
    await browser.press('Escape')
    const closing = await browser.evaluate(`${TRAILER} ? ${ANIMATED} : 'closed at once'`)
    await browser.waitFor(`!document.querySelector('dialog.ab-trailer')`, 5_000)
    seen[asked] = { src, opening, closing }
    await browser.evaluate(`localStorage.removeItem('anibeam:motion'); true`)
  }
  const still = { opening: ['opacity'], closing: ['opacity'] }
  assert.deepEqual(seen, {
    'motion allowed': {
      src: `${EMBED}&autoplay=1`,
      opening: ['opacity', 'transform'],
      closing: ['opacity'],
    },
    'the device': { src: EMBED, ...still },
    'the site': { src: EMBED, ...still },
  })
})

test('Esc closes the trailer, then the card, which fades or plays back out: focus goes back to Watch trailer, then to the title that opened the card', async () => {
  // Spec §3J: a modal dialog returns focus to what opened it. The trailer's frame goes as it
  // closes, which stops the video; the card stays, at its address, until the second Esc, which
  // fades it out over 150 ms under reduced motion, and plays its opening backwards with motion
  // allowed, as Esc on a card alone does. The browser lets the page hold a dialog open on Esc once
  // for each thing the visitor does, and Esc is no such thing, so the trailer's Esc mustn't use
  // that up. Safari focuses no button it clicks, so a press there leaves focus where it was, here
  // on the card's Close (as element.click() does): focus still goes back to Watch trailer.
  const seen: Record<string, unknown> = {}
  for (const [name, screen, reduceMotion, clicked] of [
    ['390px', PHONE, true, false],
    ['1440px', DESKTOP, true, false],
    ['1440px, motion allowed, pressed as Safari clicks', DESKTOP, false, true],
  ] as const) {
    await openFromSearch(screen, FRIEREN, reduceMotion)
    if (clicked) {
      await browser.evaluate(`${WATCH}.click(); true`)
      assert.ok(await browser.waitFor(TRAILER, 5_000), 'Watch trailer opened no trailer')
      await browser.animationsDone()
    } else await watchTrailer()
    await browser.press('Escape')
    await browser.waitFor(`!document.querySelector('dialog.ab-trailer')`, 5_000)
    // Long enough for the card to have faded out, had the same Esc closed it too.
    await browser.waitFor('false', 500)
    const first = await browser.evaluate(`({
      card: ${CARD}?.className ?? 'gone',
      frames: document.querySelectorAll('iframe').length,
      focus: ${FOCUS},
      address: location.pathname,
    })`)
    await browser.press('Escape')
    const leaving = await browser.evaluate(`${CARD}?.className ?? 'gone'`)
    await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5_000)
    const second = await browser.evaluate(`({
      card: Boolean(document.querySelector('dialog.ab-card')),
      focus: document.activeElement.getAttribute('href'),
      address: location.pathname,
    })`)
    seen[name] = { first, 'as the second Esc lands': leaving, second }
  }
  const expected = (leaving: string) => ({
    first: {
      card: 'ab-card is-landed',
      frames: 0,
      focus: 'Watch trailer',
      address: '/anime/154587',
    },
    'as the second Esc lands': `ab-card is-landed ${leaving}`,
    second: { card: false, focus: '/anime/154587', address: '/' },
  })
  assert.deepEqual(seen, {
    '390px': expected('is-closing'),
    '1440px': expected('is-closing'),
    '1440px, motion allowed, pressed as Safari clicks': expected('is-leaving'),
  })
})

test('a request to close the trailer that comes as its cancel event, as Android’s Back gesture makes, closes the trailer alone', async () => {
  // Esc closes the trailer as a key (see the check above), so here the cancel event the browser
  // sends for any other request to close, which no check here can make, is sent to the trailer by
  // hand. React hands it to the card's handler too, which must leave it to the trailer: the card
  // stays, at its address, and Esc then closes it.
  await openFromSearch(DESKTOP, FRIEREN)
  await watchTrailer()
  await browser.evaluate(
    `${TRAILER}.dispatchEvent(new Event('cancel', { cancelable: true })); true`,
  )
  await browser.waitFor(`!document.querySelector('dialog.ab-trailer')`, 5_000)
  // Long enough for the card to have faded out, had the request closed it too.
  await browser.waitFor('false', 500)
  const seen = await browser.evaluate(`({
    card: ${CARD}?.className ?? 'gone',
    focus: ${FOCUS},
    address: location.pathname,
  })`)
  assert.deepEqual(seen, {
    card: 'ab-card is-landed',
    focus: 'Watch trailer',
    address: '/anime/154587',
  })
})

test('Back closes the trailer, then the card, and Forward opens the trailer again; after Close, Back closes the card', async () => {
  // Pressing Watch trailer adds a history entry at the card's address, so Back (on an iPhone, a
  // swipe from the screen's edge) closes the trailer and leaves the card, and Back again closes
  // the card, as for a card alone. Closed by its own Close, the trailer takes its entry with it,
  // so Back then closes the card, rather than seeming to do nothing.
  const state = () =>
    browser.evaluate(`({
      trailer: Boolean(document.querySelector('dialog.ab-trailer')),
      card: Boolean(document.querySelector('dialog.ab-card')),
      address: location.pathname,
      focus: document.activeElement.getAttribute('href') ?? ${FOCUS},
    })`)
  const back = async (closed: string) => {
    await browser.evaluate(`history.back(); true`)
    await browser.waitFor(`!document.querySelector('${closed}')`, 5_000)
    return state()
  }
  const seen: Record<string, unknown> = {}
  await openFromSearch(DESKTOP, FRIEREN)
  await watchTrailer()
  seen['Back'] = await back('dialog.ab-trailer')
  await browser.evaluate(`history.forward(); true`)
  await browser.waitFor(TRAILER, 5_000)
  await browser.animationsDone()
  seen['Forward'] = await state()
  await back('dialog.ab-trailer')
  seen['Back again'] = await back('dialog.ab-card')
  await openFromSearch(DESKTOP, FRIEREN)
  await watchTrailer()
  await browser.press('Enter')
  await browser.waitFor(`!document.querySelector('dialog.ab-trailer')`, 5_000)
  seen['Close'] = await state()
  seen['then Back'] = await back('dialog.ab-card')
  assert.deepEqual(seen, {
    Back: { trailer: false, card: true, address: '/anime/154587', focus: 'Watch trailer' },
    Forward: { trailer: true, card: true, address: '/anime/154587', focus: 'Close' },
    'Back again': {
      trailer: false,
      card: false,
      address: '/',
      focus: '/anime/154587',
    },
    Close: { trailer: false, card: true, address: '/anime/154587', focus: 'Watch trailer' },
    'then Back': {
      trailer: false,
      card: false,
      address: '/',
      focus: '/anime/154587',
    },
  })
})

test('a double-click on Watch trailer opens the trailer and leaves it open, its second click landing on the dimmed card', async () => {
  // Many visitors double-click a button out of habit, and a phone hands both taps of a double tap
  // to the page as clicks. The first opens the trailer, whose dimmed card then covers the button,
  // so the second lands on it, outside the panel: it is one press, not a click around the trailer.
  // The button is where the card shows it on a laptop, and scrolled to the screen's foot on a
  // phone, both outside the panel, as the check reads once the trailer is open.
  const seen: Record<string, unknown> = {}
  for (const screen of [PHONE, DESKTOP]) {
    await openFromSearch(screen, FRIEREN)
    if (screen.phone) await browser.evaluate(`${WATCH}.scrollIntoView({ block: 'end' }); true`)
    const { x, y } = await middleOf(WATCH)
    const from = requests.length
    await click(x, y, 1)
    await sleep(90)
    await click(x, y, 2)
    await browser.waitFor('false', 600)
    seen[`${screen.width}px`] = await browser.evaluate(`({
      trailer: Boolean(${TRAILER}),
      'under the pointer': document.elementFromPoint(${x}, ${y})?.className ?? null,
      entry: { ...history.state, trailer: typeof history.state.trailer },
    })`)
    seen[`${screen.width}px, from YouTube or Google`] = fromGoogle(from).length
  }
  const expected = {
    trailer: true,
    'under the pointer': 'ab-trailer',
    entry: { over: '/', trailer: 'string' },
  }
  assert.deepEqual(seen, {
    '390px': expected,
    '390px, from YouTube or Google': 1,
    '1440px': expected,
    '1440px, from YouTube or Google': 1,
  })
})

test('a click on the dimmed card around the trailer closes it, and a click or a drag that starts in its panel doesn’t', async () => {
  // Spec §3A: a click around the trailer closes it, as Close does: focus goes back to Watch
  // trailer, the card stays at its address, and Back then closes the card. A click on the panel
  // (here its title) leaves it open, as does a drag that starts there, as in selecting the title,
  // and ends outside it: the browser hands that drag's click to the dialog, as it holds both ends.
  const state = () =>
    browser.evaluate<Record<string, unknown>>(`({
      trailer: Boolean(document.querySelector('dialog.ab-trailer')),
      card: Boolean(document.querySelector('dialog.ab-card')),
      address: location.pathname,
      focus: document.activeElement.getAttribute('href') ?? ${FOCUS},
    })`)
  const seen: Record<string, unknown> = {}
  for (const screen of [PHONE, DESKTOP]) {
    await openFromSearch(screen, FRIEREN)
    await watchTrailer()
    const title = await middleOf(`${TRAILER}.querySelector('.ab-trailer-title')`)
    await click(title.x, title.y)
    await browser.waitFor('false', 400)
    // Where focus goes, Chrome decides for a click on text in a modal dialog: the dialog itself.
    const { focus: _clicked, ...clicked } = await state()
    // From the title to the dimmed card's corner, above and left of the panel.
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...title })
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...title,
      button: 'left',
      clickCount: 1,
    })
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 6, y: 6, buttons: 1 })
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 6,
      y: 6,
      button: 'left',
      clickCount: 1,
    })
    await browser.waitFor('false', 400)
    const { focus: _dragged, ...dragged } = await state()
    await click(6, 6)
    await browser.waitFor(`!document.querySelector('dialog.ab-trailer')`, 5_000)
    const around = await state()
    await browser.evaluate(`history.back(); true`)
    await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5_000)
    seen[`${screen.width}px`] = {
      'a click on its title': clicked,
      'a drag from its title': dragged,
      'a click around it': around,
      'then Back': await state(),
    }
  }
  const open = { trailer: true, card: true, address: '/anime/154587' }
  const expected = {
    'a click on its title': open,
    'a drag from its title': open,
    'a click around it': {
      trailer: false,
      card: true,
      address: '/anime/154587',
      focus: 'Watch trailer',
    },
    'then Back': { trailer: false, card: false, address: '/', focus: '/anime/154587' },
  }
  assert.deepEqual(seen, { '390px': expected, '1440px': expected })
})

test('reloaded with the trailer open, the card comes back without it, back at its own entry, and Back after Watch trailer and Close still closes the card', async () => {
  // A reload loads nothing from YouTube until Watch trailer is pressed again (spec §5), so the
  // card comes back alone. The trailer's entry it reloaded at, the card's own entry just before
  // it, would leave the card two entries: the card goes Back to its own, so one Back still closes
  // it, as for a card that never had a trailer.
  const state = () =>
    browser.evaluate<object>(`({
      trailer: Boolean(document.querySelector('dialog.ab-trailer')),
      card: Boolean(document.querySelector('dialog.ab-card')),
      address: location.pathname,
    })`)
  const seen: Record<string, unknown> = {}
  await openFromSearch(DESKTOP, FRIEREN)
  await watchTrailer()
  const from = requests.length
  await browser.send('Page.reload')
  await browser.waitFor(
    `document.readyState === 'complete' && document.querySelector('dialog.ab-card.is-landed')`,
    10_000,
  )
  await browser.animationsDone()
  await browser.waitFor('false', 500)
  seen['reloaded'] = { ...(await state()), google: fromGoogle(from) }
  await watchTrailer()
  await browser.press('Enter')
  await browser.waitFor(`!document.querySelector('dialog.ab-trailer')`, 5_000)
  await browser.waitFor('false', 500)
  seen['Watch trailer, then Close'] = await state()
  await browser.evaluate(`history.back(); true`)
  await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5_000)
  seen['then Back'] = await state()
  assert.deepEqual(seen, {
    reloaded: { trailer: false, card: true, address: '/anime/154587', google: [] },
    'Watch trailer, then Close': { trailer: false, card: true, address: '/anime/154587' },
    'then Back': { trailer: false, card: false, address: '/' },
  })
})

test('after a reload, Forward back to where the trailer was open opens the card without it, loading nothing from YouTube or Google', async () => {
  // Forward to the trailer's history entry opens the trailer again, as a press in this page load
  // put it there. After a reload, or a tab the browser brings back, nobody has pressed Watch
  // trailer yet, so the entry opens no trailer (spec §5: only a press loads anything from
  // YouTube), and the page goes Back to the card's own entry, as for a card opened there.
  const state = () =>
    browser.evaluate<object>(`({
      trailer: Boolean(document.querySelector('dialog.ab-trailer')),
      card: Boolean(document.querySelector('dialog.ab-card')),
      frames: document.querySelectorAll('iframe').length,
      address: location.pathname,
    })`)
  const seen: Record<string, unknown> = {}
  await openFromSearch(DESKTOP, FRIEREN, false)
  await watchTrailer()
  await browser.evaluate(`history.back(); true`)
  await browser.waitFor(`!document.querySelector('dialog.ab-trailer')`, 5_000)
  await browser.evaluate(`history.back(); true`)
  await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5_000)
  await browser.send('Page.reload')
  await browser.waitFor(`document.readyState === 'complete' && document.querySelector('#main')`)
  const from = requests.length
  await browser.evaluate(`history.forward(); true`)
  await browser.waitFor(`document.querySelector('dialog.ab-card.is-landed')`, 10_000)
  await browser.animationsDone()
  seen['Forward'] = await state()
  await browser.evaluate(`history.forward(); true`)
  await browser.waitFor('false', 1_000)
  seen['Forward again'] = { ...(await state()), google: fromGoogle(from) }
  await browser.evaluate(`history.back(); true`)
  await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5_000)
  seen['then Back'] = await state()
  const card = { trailer: false, card: true, frames: 0, address: '/anime/154587' }
  assert.deepEqual(seen, {
    Forward: card,
    'Forward again': { ...card, google: [] },
    'then Back': { trailer: false, card: false, frames: 0, address: '/' },
  })
})

test('a card at its address that closes while the trailer’s Back is still on its way leaves the page at /, the card not coming back', async () => {
  // Closed by itself, the trailer goes Back from its history entry, which the browser does a
  // moment later. A card opened at its address puts / in place of the address it is at as it
  // closes: closing meanwhile, it would put it in place of the trailer's entry, and the trailer's
  // Back would then land on the card's own, opening it again. Here the card's close event comes in
  // the same task as the trailer's, before the browser can have gone Back, as one could on a busy
  // machine: the dialog's close() would queue its event, so the event is sent at once instead, and
  // the dialog closed after it.
  await browser.forget()
  await browser.load({ ...DESKTOP, reduceMotion: true, url: at(`/anime/${FRIEREN}`) })
  assert.ok(
    await browser.waitFor(`document.querySelector('dialog.ab-card.is-landed')`, 10_000),
    'no card for Frieren',
  )
  await browser.animationsDone()
  await watchTrailer()
  await browser.evaluate(`(() => {
    const trailer = ${TRAILER}
    trailer.addEventListener('close', () => {
      const card = document.querySelector('dialog.ab-card')
      card.dispatchEvent(new Event('close'))
      card.close()
    })
    trailer.querySelector('button').click()
    return true
  })()`)
  await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5_000)
  await browser.waitFor('false', 1_000)
  assert.deepEqual(
    await browser.evaluate(`({
      card: Boolean(document.querySelector('dialog.ab-card')),
      address: location.pathname,
    })`),
    { card: false, address: '/' },
  )
})

test('Tab goes round the trailer, Close, Open on YouTube and the video, and never to the card behind it', async () => {
  // The trailer is modal, so the card behind it is inert. Past the video, which holds YouTube's
  // own controls (here, as YouTube can't be reached, Chrome's error page), Chrome takes focus to
  // its own controls (none, run like this): how it then comes back through a frame from another
  // site is Chrome's, so only the first stops and where every stop is are held to.
  const seen: Record<string, string[]> = {}
  for (const screen of [PHONE, DESKTOP]) {
    await openFromSearch(screen, FRIEREN)
    await watchTrailer()
    const stops = [await browser.evaluate<string>(FOCUS)]
    for (let stop = 0; stop < 6; stop++) {
      await browser.press('Tab')
      stops.push(
        await browser.evaluate<string>(`(() => {
          const part = document.activeElement
          return part && part !== document.body && !part.closest('dialog.ab-trailer') ? 'outside: ' + ${FOCUS} : ${FOCUS}
        })()`),
      )
    }
    seen[`${screen.width}px`] = stops
    await browser.press('Escape')
  }
  for (const [screen, stops] of Object.entries(seen)) {
    assert.deepEqual(
      stops.filter((stop) => stop.startsWith('outside')),
      [],
      `${screen}: Tab left the trailer (${stops.join(' → ')})`,
    )
    assert.deepEqual(
      stops.slice(0, 3),
      ['Close', 'Open on YouTube', 'the video'],
      `${screen}: ${stops.join(' → ')}`,
    )
  }
})

test('in a contrast theme, the trailer’s panel, its buttons and Watch trailer’s mark keep the theme’s colors, every border at 3:1 and every label at 4.5:1', async () => {
  // A contrast theme drops the paper, the hard shadow and the black behind the video: the panel
  // keeps its ink frame, drawn in the theme's text color, and the buttons theirs, in a light
  // palette and a dark one.
  const seen: string[] = []
  try {
    for (const scheme of ['light', 'dark']) {
      await openFromSearch(DESKTOP, FRIEREN)
      await browser.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-color-scheme', value: scheme },
        ],
      })
      const mark = await browser.evaluate<{ fill: string; color: string }>(`(() => {
        const play = document.querySelector('dialog.ab-card[open] .ab-play')
        return { fill: getComputedStyle(play).fill, color: getComputedStyle(play.closest('button')).color }
      })()`)
      if (mark.fill !== mark.color)
        seen.push(`${scheme}: Watch trailer's mark is ${mark.fill}, its label ${mark.color}`)
      await watchTrailer()
      const parts = await browser.evaluate<
        { part: string; what: string; ratio: number; least: number }[]
      >(`(() => {
        const trailer = ${TRAILER}
        const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        const lum = (color) => { const [r, g, b] = color.match(/[\\d.]+/g).map(Number); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b) }
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return Math.round(((x + 0.05) / (y + 0.05)) * 10) / 10 }
        const probe = document.body.appendChild(document.createElement('i'))
        probe.style.backgroundColor = 'Canvas'
        const canvas = getComputedStyle(probe).backgroundColor
        probe.remove()
        const found = []
        const panel = trailer.querySelector('.ab-trailer-panel')
        const p = getComputedStyle(panel)
        found.push({ part: 'the panel', what: 'border ' + p.borderTopStyle + ' ' + p.borderTopWidth, ratio: p.borderTopStyle === 'solid' ? ratio(p.borderTopColor, canvas) : 0, least: 3 })
        for (const control of trailer.querySelectorAll('.ab-trailer-bar > a, .ab-trailer-bar > button')) {
          const s = getComputedStyle(control)
          const name = control.textContent.trim()
          const under = /rgba\\(.*, 0\\)$/.test(s.backgroundColor) ? canvas : s.backgroundColor
          found.push({ part: name, what: 'label', ratio: ratio(s.color, under), least: 4.5 })
          found.push({ part: name, what: 'border', ratio: parseFloat(s.borderTopWidth) ? ratio(s.borderTopColor, canvas) : 0, least: 3 })
        }
        return found
      })()`)
      for (const { part, what, ratio, least } of parts)
        if (ratio < least) seen.push(`${scheme}, ${part}'s ${what}: ${ratio}:1, under ${least}:1`)
      if (parts.length !== 5) seen.push(`${scheme}: read ${parts.length} parts, not 5`)
      await browser.press('Escape')
    }
  } finally {
    await browser.send('Emulation.setEmulatedMedia', { features: [] })
  }
  assert.deepEqual(seen, [], 'parts of the trailer lost in a contrast theme')
})
