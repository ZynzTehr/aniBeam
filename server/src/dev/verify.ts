// The dev entry's sign-in, for trying the chat on this computer with no Firebase project (D8):
// the token dev:<name> signs in as the user dev:<name>, so anyone can be anyone. Only
// src/dev/demo.ts uses it, and src/index.ts never reaches this folder (import-graph.test.ts).
import { BadToken, type Verify } from '../auth/verify.ts'

/** dev: and a name of 1 to 20 of A to Z, a to z, 0 to 9 and _, the characters a handle has. */
const DEV_TOKEN = /^dev:[A-Za-z0-9_]{1,20}$/

/** Takes dev:<name> as the uid dev:<name>, kept as typed, so dev:Aki and dev:aki are two users. */
export const devVerifier: Verify = async (token) => {
  if (!DEV_TOKEN.test(token)) throw new BadToken('not dev:<name>')
  return { uid: token }
}
