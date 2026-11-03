// Loaded into each server test file's process before the file runs (npm test's --import): fetch
// refuses every address but this computer's, so that no test reaches Google's key server, or
// anything else on the internet, even by mistake. A test that tries fails, naming the address.
import { guard } from './fetch-guard.ts'

globalThis.fetch = guard(globalThis.fetch)
