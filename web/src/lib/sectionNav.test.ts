import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentSection, sectionLine } from './sectionNav.ts'

test('a section counts as reached two thirds of the way down the screen below the header', () => {
  // A 78px header on a 900px screen: 78 + (822 * 2/3).
  assert.equal(sectionLine(78, 900), 78 + 548)
  // A header scrolled away (a phone's) leaves the whole screen.
  assert.equal(sectionLine(-120, 844), (844 * 2) / 3)
  assert.equal(sectionLine(0, 600), 400)
})

test('the section the visitor is in is the last whose top has passed the line', () => {
  assert.equal(currentSection([900, 1800, 2600], 600, false), -1, 'above the first')
  assert.equal(currentSection([600, 1500, 2300], 600, false), 0, 'on the line counts')
  assert.equal(currentSection([601, 1500, 2300], 600, false), -1, 'a pixel short does not')
  assert.equal(currentSection([-900, 300, 1100], 600, false), 1)
  assert.equal(currentSection([-2000, -1200, -100], 600, false), 2)
  // A section not on the page is skipped.
  assert.equal(currentSection([-900, undefined, 1100], 600, false), 0)
})

test('at the end of the page the last section is the visitor’s, short as it may be', () => {
  // Its top can't reach the line once the page can scroll no further.
  assert.equal(currentSection([-1400, -600, 700], 600, true), 2)
  assert.equal(currentSection([-1400, -600, undefined], 600, true), 1)
  assert.equal(currentSection([undefined, undefined, undefined], 600, true), -1)
})
