// The Mood page's strings (A14), in one place: the lab draws them where they show, and section 3
// lists them for one-pass approval.

/** The rarity rule under the rolled card (A11): the plan's wording, or its alternative. */
export const RULES = {
  never: 'Rarity is just the AniList score. It never changes what you roll.',
  luck: 'Rarity is the AniList score, not luck.',
}

/** The lever's visible words and its name (A10). */
export const LEVER = {
  roll: { first: 'Roll!', again: 'Again!', name: 'Roll a random anime' },
  pull: { first: 'Pull!', again: 'Again!', name: undefined },
}

/** The line under the lever. */
export const countLine = (rolls: number, pull: boolean) => {
  const word = pull ? 'pull' : 'roll'
  return rolls === 0 ? `No ${word}s yet` : `${rolls} ${rolls === 1 ? word : `${word}s`} this visit`
}

/** What the status line reads as a roll's card shows. */
export const statusLine = (roll: number, title: string, rarity: string | null) =>
  rarity ? `Roll ${roll}: ${title}, ${rarity}.` : `Roll ${roll}: ${title}.`

/** The page's state lines. */
export const LINES = {
  loading: 'Filling the machine…',
  outage: (n: number) => `AniList can’t be reached. Rolling from ${n} sample titles.`,
  offline: 'Offline: waiting for a connection.',
  limited: 'AniList is busy right now. It’s not something you did. Trying again within a minute.',
  few: (n: number) => `Only ${n} ${n === 1 ? 'title' : 'titles'} left to roll in this era.`,
  repeat: 'Every match has come up once. Repeats start now.',
  empty: 'Nothing left for these filters. Widen the era or reset moods.',
}

/** The doors into /mood (A2, A3). */
export const DOORS = {
  hint: 'Fine-tune it with mood sliders',
  search: (term: string) => `No results for “${term}”. Try the Mood Matcher.`,
  /** The part of the search's line that links to /mood. */
  searchLink: 'Try the Mood Matcher.',
  allListed: 'Everything in the machine is on your list. Try another decade below.',
  teaser: 'Open the Mood Matcher',
  menu: 'ムード',
}

/** The page's heading, title, the sliders' group name and the matches' headings. */
export const PAGE = {
  heading: 'Mood Matcher',
  sfx: 'ムード!',
  title: 'Mood Matcher · AniBeam',
  group: 'Your mood',
  top: 'Top matches',
  popular: (era: string) => `Most popular in ${era}`,
  reset: 'Reset moods',
}
