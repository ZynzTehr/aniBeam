import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { tagsOf, type TagFlags } from './tags.ts'

type Saved = TagFlags & { name?: string; rank: number }
const saved = JSON.parse(readFileSync(new URL('./saved-details.json', import.meta.url), 'utf8'))
const tags = (title: string): Saved[] => saved.tags[title]
const names = (list: Saved[]) => list.map((tag) => tag.name)
const ranks = (list: Saved[]) => list.map((tag) => tag.rank)

test("tagsOf keeps Attack on Titan's top 8 tags, and its top 8 spoilers apart", () => {
  const all = tags('Attack on Titan')
  assert.equal(all.length, 29) // 9 of them spoilers
  const { shown, spoilers } = tagsOf(all)
  assert.deepEqual(names(shown), [
    'Kaiju',
    'Revenge',
    'Military',
    'Male Protagonist',
    'Primarily Teen Cast',
    'Post-Apocalyptic',
    'Survival',
    'Gore',
  ])
  // Tragedy (89) is flagged both ways and Henshin (88) only as a spoiler of this title; Time Skip
  // only as a spoiler in general. Suicide (55), the ninth, waits out.
  assert.deepEqual(names(spoilers), [
    'Tragedy',
    'Henshin',
    'Super Power',
    'Memory Manipulation',
    'Cannibalism',
    'Espionage',
    'Amnesia',
    'Time Skip',
  ])
})

test("tagsOf caps One Piece's 75 tags at 8 and 8, by rank", () => {
  const all = tags('One Piece')
  assert.equal(all.length, 75) // 18 of them spoilers
  const { shown, spoilers } = tagsOf(all)
  assert.deepEqual(ranks(shown), [98, 94, 93, 93, 90, 88, 83, 81])
  assert.deepEqual(ranks(spoilers), [81, 79, 76, 73, 67, 65, 61, 60])
  assert.ok(spoilers.every((tag) => tag.isGeneralSpoiler || tag.isMediaSpoiler))
  assert.ok(shown.every((tag) => !tag.isGeneralSpoiler && !tag.isMediaSpoiler))
})

test("tagsOf drops an adult tag, even as a spoiler (Sword Art Online's, rank 50)", () => {
  const all = tags('Sword Art Online')
  assert.equal(all.filter((tag) => tag.isAdult).length, 1)
  const { shown, spoilers } = tagsOf(all, Infinity)
  assert.deepEqual(ranks(spoilers), [92, 75, 67, 60, 58, 41, 32])
  assert.equal(shown.length + spoilers.length, 23)
  assert.ok([...shown, ...spoilers].every((tag) => !tag.isAdult))
})

test('tagsOf sorts by rank whatever order the tags come in, and leaves them be', () => {
  const all = tags('Attack on Titan')
  const copy = structuredClone(all)
  const { shown, spoilers } = tagsOf(all.toReversed())
  assert.deepEqual(ranks(shown), [93, 93, 88, 86, 86, 84, 84, 77])
  assert.deepEqual(ranks(spoilers), [89, 88, 81, 77, 69, 68, 60, 60])
  assert.deepEqual(all, copy)
})

test('tagsOf takes missing tags, ranks and flags', () => {
  for (const none of [null, undefined, []])
    assert.deepEqual(tagsOf(none), { shown: [], spoilers: [] })
  const tag = (name: string, flags: Partial<TagFlags>) => ({
    name,
    rank: null,
    isAdult: null,
    isGeneralSpoiler: null,
    isMediaSpoiler: null,
    ...flags,
  })
  const { shown, spoilers } = tagsOf([
    tag('unranked', {}),
    tag('ranked', { rank: 40 }),
    tag('adult spoiler', { rank: 90, isAdult: true, isMediaSpoiler: true }),
    tag('spoiler', { isGeneralSpoiler: true }),
  ])
  assert.deepEqual(
    shown.map((t) => t.name),
    ['ranked', 'unranked'],
  )
  assert.deepEqual(
    spoilers.map((t) => t.name),
    ['spoiler'],
  )
})
