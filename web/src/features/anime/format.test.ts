import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatOf, hasSmallCover, nextEpisode, seasonOf, studioOf, titleOf } from './format.ts'
import type { Media } from './queries.ts'

const media = (overrides: Partial<Media> = {}): Media => ({
  id: 1,
  title: { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End", native: null },
  coverImage: {
    extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.png',
    large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1.png',
    color: '#e4a15d',
  },
  bannerImage: null,
  genres: [],
  averageScore: null,
  format: 'TV',
  episodes: 28,
  season: 'FALL',
  seasonYear: 2023,
  studios: { nodes: [{ name: 'Madhouse' }] },
  nextAiringEpisode: null,
  ...overrides,
})

test('titleOf prefers the English title and falls back to romaji', () => {
  assert.equal(titleOf(media()), "Frieren: Beyond Journey's End")
  assert.equal(
    titleOf(media({ title: { romaji: 'Mushishi', english: null, native: null } })),
    'Mushishi',
  )
})

test('seasonOf names the season when AniList knows it', () => {
  assert.equal(seasonOf(media()), 'Fall 2023')
  assert.equal(seasonOf(media({ season: null })), '2023')
  assert.equal(seasonOf(media({ season: null, seasonYear: null })), 'Year unknown')
})

test('formatOf reads like English, and passes unknown formats through', () => {
  assert.equal(formatOf(media({ format: 'TV_SHORT' })), 'TV short')
  assert.equal(formatOf(media({ format: 'NEW_FORMAT' })), 'NEW_FORMAT')
  assert.equal(formatOf(media({ format: null })), null)
})

test('studioOf gives the main studio, or null', () => {
  assert.equal(studioOf(media()), 'Madhouse')
  assert.equal(studioOf(media({ studios: { nodes: [] } })), null)
})

test('nextEpisode counts down from the airing time, so cached results stay right', () => {
  const now = Date.UTC(2026, 9, 8, 12) // 2026-10-08 12:00 UTC
  const at = (hoursFromNow: number) => ({
    nextAiringEpisode: { episode: 9, airingAt: now / 1000 + hoursFromNow * 3600 },
  })
  assert.equal(nextEpisode(media(at(52)), now), 'Ep 9 in 2d 4h')
  assert.equal(nextEpisode(media(at(24)), now), 'Ep 9 in 1d 0h')
  assert.equal(nextEpisode(media(at(5)), now), 'Ep 9 in 5h')
  assert.equal(nextEpisode(media(at(0.1)), now), 'Ep 9 in 1h')
  assert.equal(nextEpisode(media(at(-1)), now), null) // aired since the result was cached
  assert.equal(nextEpisode(media(), now), null)
})

test('hasSmallCover spots AniList pointing extraLarge at the 230px folder', () => {
  assert.equal(hasSmallCover(media()), false)
  const small = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b207329.png'
  assert.equal(
    hasSmallCover(media({ coverImage: { extraLarge: small, large: small, color: null } })),
    true,
  )
})
