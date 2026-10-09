/**
 * Try again after a failed load. Pressing it first moves focus to the section's heading: the
 * button disappears while the retry runs, and focus would otherwise fall back to the top of
 * the page, losing a keyboard user's place.
 */
export function RetryButton({ headingId, onRetry }: { headingId: string; onRetry: () => void }) {
  return (
    <button
      type="button"
      className="ab-btn ab-retry"
      onClick={() => {
        document.getElementById(headingId)?.focus()
        onRetry()
      }}
    >
      Try again
    </button>
  )
}
