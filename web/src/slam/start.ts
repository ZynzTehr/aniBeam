import './slam.css'
import { applyKnobs, setLand, watchParts } from './parts.ts'
import type { SlamEngine } from './switch.ts'

/** Starts the scroll-slam prototype with `engine` (see switch.ts). Loaded only when asked for. */
export async function startSlam(engine: SlamEngine) {
  document.documentElement.dataset.slam = engine
  applyKnobs(location.search)
  if (engine === 'native') {
    const { startNative } = await import('./native.ts')
    startNative()
  }
  // Until the GSAP engine lands them, its parts show at once.
  else watchParts((parts) => parts.forEach((part) => setLand(part, 'done')))
}
