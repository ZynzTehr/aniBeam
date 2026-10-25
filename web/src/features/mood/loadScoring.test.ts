import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moodScoring, preloadScoring, scoringLoader } from './loadScoring.ts'
import { rankMatches, whyOf } from './score.ts'
import * as scoring from './scoring.ts'

// The mood scoring is a file of its own, which Discover's machine asks for by import() (the plan's
// D5). An import that fails, offline or from an old tab after a deploy renamed the file, must not
// stay failed: Try again would get the same error back, and the matches would wait forever.
test('the mood scoring’s loader runs once, and after a failed import the next call loads it', async () => {
  let calls = 0
  const loader = scoringLoader(async () => {
    calls++
    if (calls === 1) throw new TypeError('Failed to fetch dynamically imported module')
    return scoring
  })
  const first = loader.load()
  assert.equal(loader.load(), first, 'a call while the import ran started another')
  await assert.rejects(first, TypeError)
  assert.equal(loader.current, undefined, 'a failed import left something in its place')
  const retried = await loader.load().catch((error: unknown) => error)
  assert.equal(retried, scoring, 'after the import failed, the next call got its error again')
  assert.equal(loader.current, scoring, 'the scoring, once loaded, is not kept for the machine')
  assert.equal(await loader.load(), scoring)
  assert.equal(calls, 2, `ran the import ${calls} times, not twice`)
})

test('the mood scoring’s file holds the scoring itself: rankMatches and whyOf', async () => {
  const loaded = await moodScoring.load()
  assert.equal(loaded.rankMatches, rankMatches)
  assert.equal(loaded.whyOf, whyOf)
  assert.equal(moodScoring.current, loaded)
})

test('the mood scoring loads when the browser is next idle, and a failure there is let go', async () => {
  let calls = 0
  const waiting: (() => void)[] = []
  const later = (run: () => void) => void waiting.push(run)
  const failing = scoringLoader(async () => {
    calls++
    throw new TypeError('Failed to fetch dynamically imported module')
  })
  preloadScoring(failing, later)
  assert.equal(calls, 0, 'it loaded before the browser was idle')
  waiting.splice(0).forEach((run) => run())
  assert.equal(calls, 1)
  // The failure is caught: an unhandled rejection would fail this test.
  await new Promise((resolve) => setTimeout(resolve, 0))
  const loader = scoringLoader(async () => scoring)
  await loader.load()
  preloadScoring(loader, later)
  assert.deepEqual(waiting, [], 'it waited to load the scoring once more, already loaded')
})
