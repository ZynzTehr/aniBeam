import { useEffect, useRef } from 'react'
import { RetryButton } from './RetryButton.tsx'

/**
 * What a title opened at its address (/anime/:id) shows in place of its card while AniList can't
 * give it: why (see titleNote in app/status.ts), Try again when a retry could help, and Close. It
 * opens as a native modal dialog, as the card does, so Esc closes it too.
 */
export function TitleNotice({
  text,
  onRetry,
  onClose,
}: {
  text: string
  onRetry?: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  // No cleanup: removing the element closes it. Opening it focuses the first thing in it that can
  // take focus, which is the note (for Try again, below), so focus goes on to Close, as it starts on
  // the title card's close button.
  useEffect(() => {
    if (ref.current?.open) return
    ref.current?.showModal()
    close.current?.focus()
  }, [])
  return (
    <dialog ref={ref} className="ab-notice" aria-labelledby="ab-notice-text" onClose={onClose}>
      {/* Focusable, for Try again to hand focus to as it hides while the retry runs. */}
      <p id="ab-notice-text" className="ab-notice-text" tabIndex={-1}>
        {text}
      </p>
      <div className="ab-row-actions">
        {onRetry && <RetryButton headingId="ab-notice-text" onRetry={onRetry} />}
        <button
          ref={close}
          type="button"
          className="ab-btn ab-btn-ink"
          onClick={() => ref.current?.close()}
        >
          Close
        </button>
      </div>
    </dialog>
  )
}
