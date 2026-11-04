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
  return {
    sent,
    text: (id: string) => element(id).textContent,
    /** The bodies on the page, in order. */
    shown: () => element('messages').children.map((item) => item.children[2].textContent),
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
