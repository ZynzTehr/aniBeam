import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Vercel serves web/ (its project's root directory) as files. A typed or shared address such as
// /anime/154587 is no file, so without a rewrite Vercel answers it 404, and the app never runs.
// `npm run dev` and `vite preview` both answer every address with index.html themselves, so
// neither can catch a missing rewrite: only this check can. Vercel looks for a file first, so the
// built scripts, styles and fonts are still served as themselves.
const web = fileURLToPath(new URL('../../', import.meta.url))
const config = JSON.parse(readFileSync(`${web}vercel.json`, 'utf8'))

// The addresses a visitor can type or be sent: the app sends those it doesn't know to /.
const ADDRESSES = ['/', '/anime/154587', '/anime/154587/', '/anime/1?ep=5', '/list', '/a/b/c']

test('Vercel sends every address to the app, so a shared /anime/:id link opens its title', () => {
  // The user's choice for PR 9: every path, not only /anime/ (unknown paths reach the app).
  assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: '/index.html' }])
  // Vercel reads a source as a path pattern; this one, a slash then anything, reads the same as
  // a regular expression.
  const source = new RegExp(`^${config.rewrites[0].source}$`)
  for (const address of ADDRESSES)
    assert.match(new URL(address, 'https://ani-beam.vercel.app').pathname, source, address)
  assert.ok(existsSync(`${web}index.html`), 'the rewrite needs web/index.html, the app’s page')
})

test('Vercel changes no address on the way: no redirect, clean URLs or trailing-slash rule', () => {
  // A trailing-slash or clean-URL rule would redirect /anime/154587/ before the rewrite runs.
  assert.deepEqual(Object.keys(config), ['rewrites'])
})
