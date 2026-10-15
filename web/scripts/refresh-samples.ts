// Rewrites src/features/anime/samples.ts, the titles a section shows when it can't reach AniList,
// with one AniList request. Run it from web/ with `npm run samples` to change the titles, or when
// the type check fails after a change to Media. It writes nothing unless every title passes the
// checks below, and samples.test.ts checks the file again. Tailwind doesn't read this folder (see
// src/styles/index.css): the word line-through here is a canary, which src/app/privacy.test.ts
// looks for in the production stylesheet.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'
import { hasSmallCover } from '../src/features/anime/format.ts'
import { QUERIES, type Media } from '../src/features/anime/queries.ts'

// In display order, at most 50 (one page of AniList's answer). The first 9 fill the trending page,
// and the first 3 its biggest panels. Then come 3 to 5 for each decade, newest first.
const IDS = [
  // 2020s: Frieren, SPY x FAMILY, BOCCHI THE ROCK!, JUJUTSU KAISEN, The Apothecary Diaries
  154587, 140960, 130003, 113415, 161645,
  // 2010s: Attack on Titan, Your Name., Steins;Gate, HAIKYU!!, Violet Evergarden
  16498, 21519, 9253, 20464, 21827,
  // 2000s: Spirited Away, Fullmetal Alchemist: Brotherhood, Code Geass, K-ON!, MUSHI-SHI
  199, 5114, 1575, 5680, 457,
  // 1990s: Cowboy Bebop, Neon Genesis Evangelion, GTO, Cardcaptor Sakura, Whisper of the Heart
  1, 30, 245, 232, 585,
  // 1980s: My Neighbor Totoro, Akira, Kiki's Delivery Service, Dragon Ball
  523, 47, 512, 223,
  // 1970s: Mobile Suit Gundam, The Castle of Cagliostro, Heidi, Girl of the Alps
  80, 1430, 2225,
  // Before 1970: The Little Norse Prince, Attack No.1, Speed Racer
  1044, 1550, 1445,
]

const res = await fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ query: QUERIES.samples, variables: { ids: IDS } }),
})
const body = (await res.json()) as {
  data?: { Page: { media: Media[] } } | null
  errors?: { message: string }[]
}
if (!res.ok || !body.data) {
  console.error(`AniList answered ${res.status}: ${body.errors?.[0]?.message ?? 'no data'}`)
  process.exit(1)
}

const found = new Map(body.data.Page.media.map((media) => [media.id, media]))
const problems: string[] = []
if (new Set(IDS).size < IDS.length) problems.push('An id is in the list twice.')
const samples = IDS.flatMap((id, i) => {
  const media = found.get(id)
  if (!media) {
    problems.push(`${id} isn't in the answer, which leaves out unfinished and adult titles.`)
    return []
  }
  const name = `${id} (${media.title.english ?? media.title.romaji})`
  if (media.genres.some((genre) => genre === 'Ecchi' || genre === 'Hentai'))
    problems.push(`${name} is Ecchi or Hentai.`)
  if (!media.coverImage.color) problems.push(`${name} has no cover color.`)
  if (!media.seasonYear) problems.push(`${name} has no season year.`)
  if (i < 3 && hasSmallCover(media)) problems.push(`${name} has only a small cover.`)
  if (i === 0 && !media.bannerImage) problems.push(`${name} has no banner.`)
  return [media]
})
if (problems.length) {
  console.error(`samples.ts is unchanged:\n${problems.join('\n')}`)
  process.exit(1)
}

const file = fileURLToPath(new URL('../src/features/anime/samples.ts', import.meta.url))
const source = `// Written by scripts/refresh-samples.ts (\`npm run samples\`). To change the titles, edit
// its list and run it again.
import type { Media } from './queries.ts'

/** Well-known titles for a section to show when it can't reach AniList (see fallback.ts). */
export const SAMPLES: Media[] = ${JSON.stringify(samples)}
`
writeFileSync(file, await format(source, { ...(await resolveConfig(file)), filepath: file }))
console.log(`Wrote ${samples.length} titles to ${file}`)
