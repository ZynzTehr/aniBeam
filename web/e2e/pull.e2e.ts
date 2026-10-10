// The pull machine when no title on the page may come out of it: spec §3G keeps Ecchi out of
// the pull. Its own file, so the doctored answers stay in a profile of their own.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Browser } from './browser.ts'

/** Adds Ecchi to the genres of every title in an AniList answer. */
function tagEcchi(value: any): any {
  if (Array.isArray(value)) return value.map(tagEcchi)
  if (value === null || typeof value !== 'object') return value
  const copy = Object.fromEntries(Object.entries(value).map(([key, v]) => [key, tagEcchi(v)]))
  if (Array.isArray(copy.genres)) copy.genres = [...copy.genres, 'Ecchi']
  return copy
}

let browser: Browser
before(async () => {
  browser = await Browser.open()
  await browser.rewriteAniList(({ status, body }) => ({ status, body: tagEcchi(body) }))
  await browser.load()
})
after(() => browser?.close())

test('with nothing on the page it may hand out, the lever is off and the machine says why', async () => {
  assert.ok(await browser.titlesShown(), 'no titles on the page')
  const machine = await browser.evaluate<{ off: boolean; hint: string; capsules: number }>(`({
    off: document.querySelector('.ab-lever').disabled,
    hint: document.querySelector('.ab-hint')?.textContent ?? '',
    capsules: document.querySelectorAll('.ab-capsule').length,
  })`)
  assert.equal(machine.off, true, 'the lever can be pulled, but nothing would come out')
  assert.match(machine.hint, /another decade/)
  assert.equal(machine.capsules, 0, 'the dome shows titles that cannot come out')
})
