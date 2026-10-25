// The mood scoring, as Discover's machine gets it: a file of its own, asked for by import() once
// the browser is idle after the page has drawn (see loadScoring.ts), so the JS every visit loads
// before it draws leaves out score.ts and the mood map. Nothing else imports this file.
export { rankMatches, whyOf } from './score.ts'
