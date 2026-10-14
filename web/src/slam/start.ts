import './slam.css'
import { applyKnobs } from './parts.ts'
import type { SlamEngine } from './switch.ts'

/**
 * Starts the scroll-slam prototype with `engine` (see switch.ts). Loaded only when asked for. Each
 * engine is a chunk of its own, and marks the parts itself, so if its chunk fails to load, no
 * part waits: the page shows as it does without the prototype.
 */
export async function startSlam(engine: SlamEngine) {
  document.documentElement.dataset.slam = engine
  applyKnobs(location.search)
  if (engine === 'native') (await import('./native.ts')).startNative()
  else (await import('./gsap.ts')).startGsap()
}
