import './native.css'
import { landOf, landOnFocus, setLand, watchParts } from './parts.ts'

// Draft PR 3 (never merged): the native engine. CSS does all the moving (native.css); one
// IntersectionObserver only decides when. Ported from the research's tested spike
// (design-research/phase2-rest/scroll-motion/spike/native-slam.js).

/** How much of a part must show before it lands. */
const RATIO = 0.15

export function startNative() {
  const observer = new IntersectionObserver(
    (entries) =>
      // The parts that came into view together land one after another, in reading order.
      entries
        .filter(({ intersectionRatio, target }) => {
          const part = target as HTMLElement
          return intersectionRatio >= RATIO - 0.001 && landOf(part) === 'wait'
        })
        .map(({ target }) => target as HTMLElement)
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        .forEach(land),
    { threshold: [0, RATIO] },
  )

  // --k is the part's place among those landing together: its delay, in steps of --slam-stagger.
  // Once its animations have finished (at once with reduced motion, which has none), it is done,
  // with no animation left to replay. Only those on the page's own clock that end: the splash
  // cover's drift runs on the scroll, and finishes only once scrolled through.
  function land(part: HTMLElement, k: number) {
    observer.unobserve(part)
    part.style.setProperty('--k', String(k))
    setLand(part, 'go')
    const playing = part
      .getAnimations({ subtree: true })
      .filter(
        (animation) =>
          animation.timeline === document.timeline &&
          animation.effect?.getComputedTiming().endTime !== Infinity,
      )
      .map((animation) => animation.finished)
    void Promise.allSettled(playing).then(() => {
      if (landOf(part) !== 'go') return
      setLand(part, 'done')
      part.style.removeProperty('--k')
    })
  }

  watchParts((parts) =>
    parts.forEach((part) => {
      setLand(part, 'wait')
      observer.observe(part)
    }),
  )
  landOnFocus((part) => {
    observer.unobserve(part)
    part.style.removeProperty('--k')
  })
}
