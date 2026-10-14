import './slam.css'
import { applyKnobs, setLand, watchParts } from './parts.ts'
import type { SlamEngine } from './switch.ts'

/** Starts the scroll-slam prototype with `engine` (see switch.ts). Loaded only when asked for. */
export function startSlam(engine: SlamEngine) {
  document.documentElement.dataset.slam = engine
  applyKnobs(location.search)
  // Until an engine lands them, every part shows at once.
  watchParts((parts) => parts.forEach((part) => setLand(part, 'done')))
}
