import assert from 'node:assert/strict'
import { test } from 'node:test'
import { slamEngine } from './switch.ts'

// Draft PR 3 (phase-2-proto-scroll) is a prototype for judging two scroll-slam engines by feel,
// on the draft's Vercel preview, which is a production build, as well as on npm run dev.

test('?motion=native or ?motion=gsap picks a slam engine, on any host but the live site', () => {
  for (const host of [
    'localhost',
    '192.168.1.20',
    'ani-beam-git-phase-2-proto-scroll.vercel.app',
  ]) {
    assert.equal(slamEngine('?motion=native', host), 'native', host)
    assert.equal(slamEngine('?motion=gsap', host), 'gsap', host)
    assert.equal(slamEngine('?variant=D&motion=gsap&scale=1.2', host), 'gsap', host)
  }
})

test('without a known engine, or on the live site, the page stays as it is', () => {
  for (const search of ['', '?motion', '?motion=', '?motion=Native', '?motion=css', '?variant=D'])
    assert.equal(slamEngine(search, 'localhost'), null, search)
  assert.equal(slamEngine('?motion=native', 'ani-beam.vercel.app'), null)
  assert.equal(slamEngine('?motion=gsap', 'ani-beam.vercel.app'), null)
})
