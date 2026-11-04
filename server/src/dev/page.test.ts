import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
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
