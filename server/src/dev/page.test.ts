import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { buildApp } from '../app.ts'
import { CSP, demoPage } from './page.ts'

// The two-tab demo's page, as the dev entry serves it (demo.test.ts starts the entry itself).

const read = (file: string) => readFileSync(new URL(`page/${file}`, import.meta.url), 'utf8')

test('the page and its files answer 200, each with its type and the CSP', async (t) => {
  const app = buildApp()
  demoPage(app)
  t.after(() => app.close())
  for (const [url, type] of [
    ['/demo', /^text\/html/],
    ['/demo/demo.js', /^text\/javascript/],
    ['/demo/demo.css', /^text\/css/],
  ] as const) {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 200, url)
    assert.match(String(response.headers['content-type']), type, url)
    assert.equal(response.headers['content-security-policy'], CSP, url)
    assert.equal(response.headers['x-content-type-options'], 'nosniff', url)
  }
  assert.match(CSP, /(^|; )default-src 'self'(;|$)/)
  assert.match(CSP, /(^|; )script-src 'self'(;|$)/)
})

test('an app without the page, as the production entry is, answers 404 not-found for it', async (t) => {
  const app = buildApp()
  t.after(() => app.close())
  for (const url of ['/demo', '/demo/demo.js', '/demo/demo.css']) {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 404, url)
    assert.deepEqual(response.json(), { error: 'not-found' }, url)
  }
})

test('the page runs scripts from files alone: no inline script and no on...= handler', () => {
  const html = read('demo.html')
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  assert.deepEqual(
    scripts.map(([, attributes]) => /\bsrc="([^"]+)"/.exec(attributes)?.[1]),
    ['/socket.io/socket.io.min.js', '/demo/demo.js'],
  )
  for (const [, , inside] of scripts) assert.equal(inside.trim(), '')
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i)
  assert.doesNotMatch(html, /\sstyle\s*=|<style/i)
})

test('demo.js puts messages on the page as text, never as HTML', () => {
  const script = read('demo.js')
  // Each would read a body such as <img src=x onerror=...> as HTML.
  for (const html of [
    'innerHTML',
    'outerHTML',
    'insertAdjacentHTML',
    'document.write',
    'createContextualFragment',
    'DOMParser',
    'srcdoc',
  ])
    assert.equal(script.includes(html), false, html)
  assert.match(script, /body\.textContent = message\.body/)
  assert.match(script, /handle\.textContent = message\.handle/)
})

test('demo.js opens its socket over WebSocket alone, which always carries the Origin', () => {
  // A browser sends no Origin with a GET to its page's own server, which polling's first request
  // is, so the server, which refuses a request without one, would refuse the page's polling.
  assert.match(read('demo.js'), /transports: \['websocket'\]/)
})

// demo.js itself, run against a stand-in page, socket and fetch, so that what it does with what
// the server answers is checked without a browser.

/** A stand-in for one of the page's elements, with what demo.js reads and sets. */
class Element {
  textContent = ''
  value = ''
  checked = false
  className = ''
  title = ''
  type = ''
  disabled = false
  children: Element[] = []
  listeners = new Map<string, (event: { preventDefault(): void }) => unknown>()
  classList = { remove: () => {} }
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => unknown) {
    this.listeners.set(type, listener)
  }
  append(...children: Element[]) {
    this.children.push(...children)
  }
  replaceChildren(...children: Element[]) {
    this.children = children
  }
}

const ROOM = 'anime:154587:ep:5'
const OTHER_ROOM = 'anime:154587:ep:6'

/** A message of ROOM, as the server sends one. */
const message = (id: number, roomKey = ROOM) => ({
  id,
  roomKey,
  handle: 'aki',
  body: `message ${id}`,
  spoiler: false,
  createdAt: '2026-11-03T12:00:00.000Z',
})

/**
 * Runs demo.js on a page of stand-ins. The socket acks each event with `answer`'s answer and
 * keeps what was sent; a history read waits until the test gives it the page's messages.
 */
function demoScript(answer: (event: string, payload: { roomKey: string }) => unknown) {
  const elements = new Map<string, Element>()
  const element = (id: string) => elements.get(id) ?? elements.set(id, new Element()).get(id)!
  const sent: [string, unknown][] = []
  // As JSON, as it would go to the server: an object made inside the script has the script's own
  // Object, which deepEqual tells apart from this file's.
  const keep = (event: string, payload: unknown) =>
    sent.push([event, JSON.parse(JSON.stringify(payload))])
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const socket = {
    connected: true,
    io: { engine: { transport: { name: 'websocket' } } },
    on: (event: string, listener: (...args: unknown[]) => unknown) =>
      listeners.set(event, listener),
    emit: (event: string, payload: unknown) => void keep(event, payload),
    // The name form connects again, so that the socket signs in with the new token.
    disconnect: () => socket,
    connect: () => socket,
    timeout: () => ({
      emitWithAck: async (event: string, payload: { roomKey: string }) => {
        keep(event, payload)
        return answer(event, payload)
      },
    }),
  }
  const histories: ((messages: unknown[]) => void)[] = []
  const fetch = () =>
    Promise.resolve({
      json: () =>
        new Promise((resolve) =>
          histories.push((messages) => resolve({ messages, nextBefore: null })),
        ),
    })
  runInNewContext(read('demo.js'), {
    document: { getElementById: element, createElement: () => new Element() },
    io: () => socket,
    fetch,
  })
  /** Lets every promise demo.js is waiting on settle: the stand-ins answer at once. */
  const settled = () => new Promise((resolve) => setImmediate(resolve))
  const items = () => element('messages').children
  return {
    sent,
    text: (id: string) => element(id).textContent,
    /** Sets the box `id`'s value, as typing or picking in it would. */
    set: (id: string, value: string) => void (element(id).value = value),
    /** The bodies on the page, in order. */
    shown: () => items().map((item) => item.children[2].textContent),
    /** The Report button of the `index`th message on the page. */
    button: (index: number) => items()[index].children[3],
    /** Presses the Report button of the `index`th message on the page. */
    report: async (index: number) => {
      void items()[index].children[3].listeners.get('click')!({ preventDefault() {} })
      await settled()
    },
    /** Types `body` in the message box and presses Send. */
    send: async (body: string) => {
      element('body').value = body
      void element('send-form').listeners.get('submit')!({ preventDefault() {} })
      await settled()
    },
    /** A socket event from the server, other than message:new. */
    event: async (event: string, ...args: unknown[]) => {
      listeners.get(event)!(...args)
      await settled()
    },
    /** Types `name` in the name box and presses Sign in and set handle. */
    signIn: async (name: string) => {
      element('name').value = name
      void element('name-form').listeners.get('submit')!({ preventDefault() {} })
      await settled()
    },
    /** Types `key` in the room box and presses Join. */
    join: async (key: string) => {
      element('room').value = key
      void element('room-form').listeners.get('submit')!({
        preventDefault() {},
      })
      await settled()
    },
    /** Answers the oldest history read still waiting with `messages`. */
    history: async (...messages: unknown[]) => {
      histories.shift()!(messages)
      await settled()
    },
    /** A message:new from the server. */
    live: async (...messages: unknown[]) => {
      for (const one of messages) listeners.get('message:new')!(one)
      await settled()
    },
  }
}

test("demo.js shows a message that is in the room's history and came live too once, in id order", async () => {
  const page = demoScript(() => ({ ok: true }))
  await page.join(ROOM)
  // Sent while history loads: it is live, and in the history too.
  await page.live(message(2))
  await page.history(message(2), message(1))
  await page.live(message(3), message(2))
  assert.deepEqual(page.shown(), ['message 1', 'message 2', 'message 3'])
  // Another room's message, which the socket may still get as it leaves it, shows nowhere.
  await page.live(message(4, OTHER_ROOM))
  assert.deepEqual(page.shown(), ['message 1', 'message 2', 'message 3'])
})

test('demo.js leaves its room only once another is joined, so a join refused leaves it where it was', async () => {
  const page = demoScript((event, { roomKey }) =>
    event === 'join' && roomKey === 'bad' ? { error: 'invalid' } : { ok: true },
  )
  await page.join(ROOM)
  await page.history(message(1))
  page.sent.length = 0
  await page.join('bad')
  // Still in the room, as the page says: it never left it.
  assert.deepEqual(page.sent, [['join', { roomKey: 'bad' }]])
  assert.match(page.text('error'), /a room key looks like/)
  assert.equal(page.text('status'), `Connected over websocket, in ${ROOM}.`)
  assert.deepEqual(page.shown(), ['message 1'])
  await page.live(message(2))
  assert.deepEqual(page.shown(), ['message 1', 'message 2'])
  // Joined again, the room is not left; another is joined first, then the room left.
  page.sent.length = 0
  await page.join(ROOM)
  await page.history(message(1), message(2))
  await page.join(OTHER_ROOM)
  assert.deepEqual(page.sent, [
    ['join', { roomKey: ROOM }],
    ['join', { roomKey: OTHER_ROOM }],
    ['leave', { roomKey: ROOM }],
  ])
  assert.deepEqual(page.shown(), [])
  await page.history(message(5, OTHER_ROOM))
  assert.equal(page.text('status'), `Connected over websocket, in ${OTHER_ROOM}.`)
  assert.deepEqual(page.shown(), ['message 5'])
})

test('demo.js takes a message hidden by reports off the page, and a history read or a live copy that still has it never brings it back', async () => {
  const page = demoScript(() => ({ ok: true }))
  await page.join(ROOM)
  // Hidden while history loads: the history read began before the hide, and still has it.
  await page.live(message(2))
  await page.event('message:hidden', { id: 2, roomKey: ROOM })
  await page.history(message(3), message(2), message(1))
  assert.deepEqual(page.shown(), ['message 1', 'message 3'])
  await page.live(message(2), message(4))
  assert.deepEqual(page.shown(), ['message 1', 'message 3', 'message 4'])
  // Hidden once shown, it goes, and the rest keep their order, each once.
  await page.event('message:hidden', { id: 3, roomKey: ROOM })
  await page.live(message(4))
  assert.deepEqual(page.shown(), ['message 1', 'message 4'])
  // Joined again, as after a reconnect, the room's history merges by id as before.
  await page.join(ROOM)
  await page.history(message(4), message(3), message(2), message(1))
  assert.deepEqual(page.shown(), ['message 1', 'message 4'])
})

test('demo.js reports a message for the reason picked, and says each refusal as text, with the wait in seconds', async () => {
  let reply: unknown = { ok: true }
  const page = demoScript(() => reply)
  await page.join(ROOM)
  await page.history(message(1), message(2))
  page.sent.length = 0
  page.set('reason', 'spoiler')
  await page.report(0)
  assert.deepEqual(page.sent, [['message:report', { id: 1, reason: 'spoiler' }]])
  assert.equal(page.text('error'), '')
  assert.equal(page.button(0).textContent, 'Reported')
  assert.equal(page.button(0).disabled, true)
  assert.equal(page.button(1).textContent, 'Report')
  for (const [answer, text] of [
    [{ error: 'rate-limited', retryAfterMs: 5_500 }, 'Too many at once: wait 6 s, then try again.'],
    [{ error: 'cannot-report-own' }, "That message is yours: a report is for someone else's."],
    [{ error: 'banned' }, 'This user is banned, so it can read but not send or report.'],
    [{ error: 'not-found' }, 'That message is gone: hidden already, or never there.'],
  ] as const) {
    reply = answer
    await page.report(1)
    assert.equal(page.text('error'), text, answer.error)
    assert.equal(page.button(1).textContent, 'Report', answer.error)
  }
  // A send's refusals, the same way.
  for (const [answer, text] of [
    [{ error: 'rate-limited', retryAfterMs: 1 }, 'Too many at once: wait 1 s, then try again.'],
    [
      { error: 'rate-limited', retryAfterMs: 10_000 },
      'Too many at once: wait 10 s, then try again.',
    ],
    [{ error: 'message-blocked' }, 'That message has a word the chat refuses. Nothing was posted.'],
    [{ error: 'banned' }, 'This user is banned, so it can read but not send or report.'],
  ] as const) {
    reply = answer
    await page.send('hello')
    assert.equal(page.text('error'), text, answer.error)
  }
  // And a connection the server refused, in the status line.
  await page.event('connect_error', new Error('too-many-connections'))
  assert.equal(
    page.text('status'),
    'Refused: this computer has too many chat tabs open. Close one, then reload.',
  )
})

test('demo.js forgets what it reported once signed in as another name, and says each refusal of a connection', async () => {
  const page = demoScript(() => ({ ok: true }))
  await page.join(ROOM)
  await page.history(message(1))
  await page.report(0)
  assert.equal(page.button(0).textContent, 'Reported')
  // Another name may report it too.
  await page.signIn('kiri')
  assert.equal(page.button(0).textContent, 'Report')
  assert.equal(page.button(0).disabled, false)
  // A token the server couldn't check is the sign-in's trouble, not a post's or a report's.
  await page.event('connect_error', new Error('server-error'))
  assert.equal(page.text('status'), 'Refused: the server could not check the sign-in. Try again.')
  // Signed out, the page says what is left: reading.
  assert.match(read('demo.html'), /Signed out: you can read, but not send or report\./)
})
