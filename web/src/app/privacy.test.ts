import { readdirSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'

// The fonts are self-hosted so visitors' browsers never contact Google. The development-only
// prototypes are excluded: production builds leave them out.
test('production code never loads anything from Google Fonts', () => {
  const src = new URL('../', import.meta.url)
  const files = readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(tsx?|css)$/.test(file) && !file.startsWith('prototype'))
    .map((file) => new URL(file, src))
  files.push(new URL('../../index.html', import.meta.url))
  assert.ok(files.length > 10, `only ${files.length} files scanned`)
  for (const file of files) {
    const code = readFileSync(file, 'utf8')
    assert.doesNotMatch(
      code,
      /fonts\.(googleapis|gstatic)\.com/,
      `${file.pathname} loads Google Fonts`,
    )
  }
})
