import { useLayoutEffect, useRef } from 'react'

/**
 * Try again after a failed load. The button hides while a retry runs: after a press, and when
 * TanStack retries on its own (back online, or back on the tab). If it has focus then, focus
 * moves to the section's heading instead of falling back to the top of the page, which would
 * lose a keyboard user's place. While the button stays (offline, the retry waits), so does focus.
 */
export function RetryButton({ headingId, onRetry }: { headingId: string; onRetry: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const self = button.current
    // React runs this before it takes the button out of the page, so it can still have focus.
    return () => {
      if (!self || document.activeElement !== self) return
      // A mouse or touch press shows no focus ring, so the heading needn't scroll into view.
      document.getElementById(headingId)?.focus({ preventScroll: !self.matches(':focus-visible') })
    }
  }, [headingId])
  return (
    <button ref={button} type="button" className="ab-btn ab-retry" onClick={onRetry}>
      Try again
    </button>
  )
}
