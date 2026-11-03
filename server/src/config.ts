// The chat server's settings, read from the environment as it starts (server/.env.example lists
// them). In production a missing or unsafe one stops the start, before the server listens, with
// every problem named at once: a server started without them would let the wrong websites call
// it, or take sign-ins it has no project to check against.

/** The web dev server's origin, which an unset CORS_ORIGIN means outside production. */
export const DEV_ORIGIN = 'http://localhost:5173'

export interface Config {
  /** The web app's origins, allowed to call the server from a browser (CORS_ORIGIN). */
  corsOrigins: string[]
  /** The Firebase project whose sign-ins the server takes (FIREBASE_PROJECT_ID), if one is set. */
  firebaseProjectId: string | undefined
}

/** Reads the settings from `env`, or throws an error that names each problem, one per line. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production'
  const problems: string[] = []

  const origins = env.CORS_ORIGIN?.trim()
  if (!origins && production)
    problems.push(
      "CORS_ORIGIN is missing: set it to the web app's origin, such as https://anibeam.app.",
    )
  const corsOrigins = origins ? origins.split(',').map((entry) => entry.trim()) : [DEV_ORIGIN]
  // A browser sends its page's origin exactly: a scheme, a host and a port if any, with no path
  // and no / at the end, so an entry written any other way would never match and is a mistake.
  // This holds outside production too, where a typo would only show as a refused request.
  for (const entry of corsOrigins)
    if (!isOrigin(entry))
      problems.push(
        `CORS_ORIGIN has ${JSON.stringify(entry)}, which isn't an origin: http:// or https://, a host and a port if any, and no path or / at the end, such as https://anibeam.app.`,
      )

  const firebaseProjectId = env.FIREBASE_PROJECT_ID?.trim() || undefined
  if (!firebaseProjectId && production)
    problems.push(
      'FIREBASE_PROJECT_ID is missing: set it to the Firebase project that signs users in.',
    )
  // Firebase's own libraries take tokens no one signed when this is set, for its emulator. The
  // server checks tokens itself and never reads it, but a production server with it set is
  // misconfigured, and would be unsafe the day a Firebase library joins.
  if (env.FIREBASE_AUTH_EMULATOR_HOST !== undefined && production)
    problems.push(
      'FIREBASE_AUTH_EMULATOR_HOST is set: unset it, since it is for the emulator only.',
    )

  if (problems.length > 0)
    throw new Error(`The chat server can't start:\n${problems.map((p) => `- ${p}`).join('\n')}`)
  return { corsOrigins, firebaseProjectId }
}

/** Whether `entry` is an http or https origin, written as a browser sends it. */
function isOrigin(entry: string) {
  try {
    const url = new URL(entry)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === entry
  } catch {
    return false
  }
}
