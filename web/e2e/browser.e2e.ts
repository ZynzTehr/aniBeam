// The browser helper itself: a Chrome that fails to start leaves nothing behind.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { Browser } from './browser.ts'

const profiles = () => readdirSync(tmpdir()).filter((name) => name.startsWith('anibeam-e2e-'))

test('a Chrome that exits at once fails fast and leaves no profile behind', async () => {
  const before = profiles()
  process.env.CHROME_BIN = '/usr/bin/false' // starts, then exits straight away
  const started = Date.now()
  await assert.rejects(Browser.open(), /exited before it was ready/)
  assert.ok(Date.now() - started < 5_000, 'it waited for a browser that had already exited')
  assert.deepEqual(profiles(), before, 'its profile folder was left behind')
})
