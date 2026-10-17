import { useEffect, useRef, useState } from 'react'
import { RetryButton } from './RetryButton.tsx'

/**
 * What a title opened at its address (/anime/:id) shows in place of its card while AniList can't
 * give it: why (see titleNote in app/status.ts), Try again when a retry could help, and Close. It
 * opens as a native modal dialog, as the card does, so Esc closes it too. It fades in and out over
 * 150 ms, as the card does under reduced motion (see .ab-notice): gone at once, the page's dim
 * would lift in a single frame.
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

  // Asked to close, it fades out, and closes as the fade ends; asked again meanwhile, it closes at
  // once. With no fade to end, as when a stylesheet of the visitor's own turns animations off, it
  // closes once the fade's 150 ms are up. Asking for its animations brings its styles up to date
  // first, so a fade that runs is there to find.
  const [closing, setClosing] = useState(false)
  const leave = () => (closing ? ref.current?.close() : setClosing(true))
  useEffect(() => {
    const notice = ref.current
    if (!closing || !notice || notice.getAnimations().length > 0) return
    const timer = window.setTimeout(() => notice.close(), 150)
    return () => clearTimeout(timer)
  }, [closing])

  return (
    <dialog
      ref={ref}
      className={closing ? 'ab-notice is-closing' : 'ab-notice'}
      aria-labelledby="ab-notice-text"
      // Esc fades it out too, unless the page holds it open, which the browser allows once for each
      // thing the visitor does on the page: the cancel event is cancelable then.
      onCancel={(event) => {
        if (!event.cancelable || closing) return
        event.preventDefault()
        setClosing(true)
      }}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) event.currentTarget.close()
      }}
      onClose={onClose}
    >
      {/* Focusable, for Try again to hand focus to as it hides while the retry runs. Read as it
          changes (retrying, then failed with Try again), not only as the note opens. */}
      <p id="ab-notice-text" className="ab-notice-text" tabIndex={-1} aria-live="polite">
        {text}
      </p>
      <div className="ab-row-actions">
        {onRetry && <RetryButton headingId="ab-notice-text" onRetry={onRetry} />}
        <button ref={close} type="button" className="ab-btn ab-btn-ink" onClick={leave}>
          Close
        </button>
      </div>
    </dialog>
  )
}
