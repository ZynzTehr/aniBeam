import type { SlamEngine } from './switch.ts'

/** Starts the scroll-slam prototype with `engine` (see switch.ts). Loaded only when asked for. */
export function startSlam(engine: SlamEngine) {
  document.documentElement.dataset.slam = engine
}
