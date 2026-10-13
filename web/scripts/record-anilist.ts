// Records AniList's answers for the browser checks into e2e/anilist/, one file per request (see
// e2e/recordings.ts). Run it from web/ with `npm run e2e:record` when recordings.test.ts says a
// recording is missing or stale: it records only those, and deletes the ones no check asks for any
// more. `-- --all` records every one again, to bring in AniList's latest titles; names
// (`-- trending search-frieren`) record just those.
//
// AniList allows 30 requests a minute per IP address, and whatever else runs on this machine shares
// them. So it asks one request at a time, at least 6.5 s apart: never more than 10 in a minute, and
// about two minutes for all 20. It writes nothing unless every answer is a 200 with no errors and a
// list of titles for each list asked for (empty for a search that matches nothing), and the
// recordings, the new ones in, hold what the checks rely on AniList's titles for (see problems()
// in e2e/recordings.ts). It prints a line for each recording saying what changed in it.
//
// The work is record() in recorder.ts. Here it is handed AniList, the clock, e2e/anilist/ and the
// terminal; recorder.test.ts hands it stand-ins for them.
import { setTimeout as sleep } from 'node:timers/promises'
import { FOLDER } from '../e2e/recordings.ts'
import { record } from './recorder.ts'

const code = await record(process.argv.slice(2), {
  fetch,
  sleep,
  now: () => Date.now(),
  folder: FOLDER,
  stdout: process.stdout,
  stderr: process.stderr,
})
// A run that stopped exits there and then, as it always has.
if (code) process.exit(code)
