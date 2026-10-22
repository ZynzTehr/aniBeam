// What the title card's My List line says after a press (said.ts): only a move, a removal, the cap
// and an edit storage refused, never a plain press (the plan's PR 1, commit 6); and the same words
// twice in a row changed just enough to be heard again (nextLine); and what the note under the
// row shows (noted): the cap and an edit storage refused, and nothing else.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextLine, noted, said } from './said.ts'

test('a move says where the title went, and a removal that it went', () => {
  assert.equal(said({ change: 'moved', saved: true }, 'WANT'), 'Moved to Want to try')
  assert.equal(said({ change: 'moved', saved: true }, 'SAVED'), 'Moved to Saved')
  assert.equal(said({ change: 'removed', saved: true }, 'SAVED'), 'Removed from My List')
  assert.equal(said({ change: 'removed', saved: true }, 'WANT'), 'Removed from My List')
})

test('a plain press says nothing: adding, the heart, or nothing changed', () => {
  for (const change of ['added', 'favorited', 'unfavorited', 'none'] as const)
    for (const pressed of ['SAVED', 'WANT', null] as const)
      assert.equal(said({ change, saved: true }, pressed), '', `${change}, ${pressed}`)
})

test('the cap says the list is full, and an edit storage refused says it is kept for the visit', () => {
  assert.equal(said({ change: 'full', saved: true }, 'SAVED'), 'My List is full (2,000)')
  assert.equal(said({ change: 'full', saved: true }, null), 'My List is full (2,000)')
  const kept = 'Couldn’t save on this device. Kept for this visit.'
  assert.equal(said({ change: 'added', saved: false }, 'SAVED'), kept)
  assert.equal(said({ change: 'favorited', saved: false }, null), kept)
  // A move or a removal storage refused says both, the move first.
  assert.equal(said({ change: 'moved', saved: false }, 'WANT'), `Moved to Want to try. ${kept}`)
  assert.equal(said({ change: 'removed', saved: false }, 'SAVED'), `Removed from My List. ${kept}`)
})

test('the same words twice in a row end in a no-break space, so the line changes and is heard again', () => {
  const full = 'My List is full (2,000)'
  assert.equal(nextLine('', full), full)
  assert.equal(nextLine(full, full), `${full}\u00a0`)
  assert.equal(nextLine(`${full}\u00a0`, full), full)
  // Other words, and nothing to say, pass through as they are.
  assert.equal(nextLine(full, 'Removed from My List'), 'Removed from My List')
  assert.equal(nextLine(`${full}\u00a0`, 'Removed from My List'), 'Removed from My List')
  assert.equal(nextLine(full, ''), '')
  assert.equal(nextLine('', ''), '')
})

test('the note under the row shows the cap, or an edit storage refused, and nothing for any other press', () => {
  const kept = 'Couldn’t save on this device. Kept for this visit.'
  assert.equal(noted({ change: 'full', saved: true }), 'My List is full (2,000)')
  for (const change of ['added', 'moved', 'removed', 'favorited', 'unfavorited', 'none'] as const) {
    assert.equal(noted({ change, saved: true }), '', `${change}, saved`)
    // A move or a removal storage refused shows only that it is kept: the buttons show the rest.
    assert.equal(noted({ change, saved: false }), kept, `${change}, refused`)
  }
})
