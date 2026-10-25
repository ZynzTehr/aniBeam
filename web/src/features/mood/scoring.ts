// The mood scoring, as Discover's machine gets it: a file of its own, asked for by import() once
// the browser is idle after the page has drawn (see loadScoring.ts), so the JS every visit loads
// before it draws leaves out score.ts and the mood map. A decade's mood pool waits for it too, for
// the mood map's tags it keeps (see poolQuery in queries.ts). Nothing else imports this file.
export { MOOD_TAGS } from './moodMap.ts'
export { rankMatches, whyOf } from './score.ts'
