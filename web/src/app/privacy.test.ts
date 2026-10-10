import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build, type Rolldown } from 'vite'

// The fonts are self-hosted so visitors' browsers never contact Google. This builds the
// production bundle in memory, fresh each run (web/dist can be missing or out of date), and
// checks every file in it, whatever folder its code came from. The development-only
// prototypes do load Google Fonts, so this fails if a change ever lets them into production.
test('the production build never loads anything from Google Fonts', async () => {
  const { output } = (await build({
    root: fileURLToPath(new URL('../../', import.meta.url)),
    logLevel: 'silent',
    build: { write: false },
  })) as Rolldown.RolldownOutput
  assert.ok(
    output.some((file) => file.fileName === 'index.html'),
    'index.html is not in the build',
  )
  for (const file of output) {
    const text = file.type === 'chunk' ? file.code : Buffer.from(file.source).toString('utf8')
    assert.doesNotMatch(
      text,
      /fonts\.(googleapis|gstatic)\.com/,
      `${file.fileName} loads Google Fonts`,
    )
  }
})
