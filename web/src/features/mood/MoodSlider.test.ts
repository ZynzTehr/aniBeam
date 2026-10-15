import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Chrome and Safari style the slider's track and thumb through ::-webkit- parts, and Firefox
// through ::-moz- ones, each in a rule of its own (a browser drops a whole rule that names a part
// it doesn't know). Only Chrome runs the browser checks, so Firefox's rules are held to Chrome's
// here: the same declarations, under the same media queries, but where an engine needs its own.
const css = readFileSync(new URL('./MoodSlider.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/** Each rule's declarations, by its selector and the at-rules it sits in. */
function rules(text: string) {
  const found = new Map<string, Map<string, string>>()
  const open: string[] = []
  let from = 0
  for (const match of text.matchAll(/[{};]/g)) {
    const chunk = text.slice(from, match.index).replace(/\s+/g, ' ').trim()
    from = match.index + 1
    if (match[0] === '{') open.push(chunk)
    else {
      const [, property, value] = /^([\w-]+)\s*:\s*(.*)$/.exec(chunk) ?? []
      if (property) {
        const key = open.join(' / ')
        found.set(key, (found.get(key) ?? new Map()).set(property, value))
      }
      if (match[0] === '}') open.pop()
    }
  }
  return found
}

// What only Chrome's rule may set: the thumb's margin-top, which centres it on the track (Firefox
// centres it itself), and appearance; and the track's dot placement, as each engine moves the
// thumb its own way (see MoodSlider.css).
const OWN = new Set(['margin-top', 'appearance', '--first', '--apart'])
const MOZ = (key: string) =>
  key
    .replace('::-webkit-slider-thumb', '::-moz-range-thumb')
    .replace('::-webkit-slider-runnable-track', '::-moz-range-track')

test("each of Firefox's slider rules matches Chrome's, but where an engine needs its own", () => {
  const all = rules(css)
  const webkit = [...all.keys()].filter((key) => key.includes('::-webkit-'))
  // So that a reading that misses can't pass, it must find the track, the thumb, the contrast
  // themes' thumb, and in the motion gate the thumb's transition and its swell when pressed.
  assert.equal(webkit.length, 5, `found ${webkit.join('; ')}`)
  const differ: string[] = []
  for (const key of webkit) {
    const chrome = all.get(key)!
    const firefox = all.get(MOZ(key))
    if (!firefox) {
      differ.push(`${MOZ(key)}: no such rule`)
      continue
    }
    for (const property of new Set([...chrome.keys(), ...firefox.keys()]))
      if (!OWN.has(property) && chrome.get(property) !== firefox.get(property))
        differ.push(
          `${MOZ(key)}: ${property} is ${firefox.get(property)}, not ${chrome.get(property)}`,
        )
  }
  assert.deepEqual(differ, [], "Firefox's slider rules differ from Chrome's")
})
