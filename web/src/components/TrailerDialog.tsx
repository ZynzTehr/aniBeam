import { useEffect, useRef, useState } from 'react'
import { embedOf, watchOf } from '../features/anime/trailer.ts'
import { isTrailer } from '../lib/route.ts'

/**
 * A title's trailer, played over its card (spec §3A) in a native modal dialog, from YouTube's
 * privacy-enhanced address (see embedOf). TitleCard makes it only as "Watch trailer" is pressed,
 * its video with it, so nothing loads from YouTube or Google before that (spec §5), and takes it
 * away once it has closed, the video with it, which stops it playing. Close, outside the video,
 * takes focus first, so the keyboard never starts in YouTube's player, where Tab and Esc are
 * YouTube's; "Open on YouTube" is always there, for a video YouTube won't play inside another site
 * (some owners forbid it, some countries block it). Esc, Close, Back, or a click on the dimmed card
 * around it, fade it out over 150 ms, as the title notice does, and it closes as the fade ends: the
 * dialog then hands focus back to Watch trailer.
 */
export function TrailerDialog({
  id,
  title,
  onClose,
}: {
  id: string
  title: string
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // No cleanup: removing the element closes it. Opening it focuses the first thing in it that can
  // take focus: Close.
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal()
  }, [])
  // The embed's address, made once: whether it plays at once (reduced motion) is settled as it
  // opens, and a new address would load the video again.
  const [src] = useState(() => embedOf(id))

  // Asked to close, it fades out, and closes as the fade ends; asked again meanwhile, it closes at
  // once. With no fade to end, as when a stylesheet of the visitor's own turns animations off, it
  // closes once the fade's 150 ms are up (see TitleNotice).
  const [closing, setClosing] = useState(false)
  const leave = () => (closing ? ref.current?.close() : setClosing(true))
  useEffect(() => {
    const trailer = ref.current
    if (!closing || !trailer || trailer.getAnimations().length > 0) return
    const timer = window.setTimeout(() => trailer.close(), 150)
    return () => clearTimeout(timer)
  }, [closing])
  // Back (on an iPhone, a swipe from the screen's edge) leaves the history entry that pressing
  // Watch trailer made (see pushTrailer), and the trailer goes with it, leaving the card.
  useEffect(() => {
    const wentBack = () => {
      if (!isTrailer(history.state)) setClosing(true)
    }
    addEventListener('popstate', wentBack)
    return () => removeEventListener('popstate', wentBack)
  }, [])

  return (
    <dialog
      ref={ref}
      className={closing ? 'ab-trailer is-closing' : 'ab-trailer'}
      aria-labelledby="ab-trailer-title"
      // Esc fades it out too, unless the page holds it open, which the browser allows once for each
      // thing the visitor does on the page: the cancel event is cancelable then.
      onCancel={(event) => {
        if (!event.cancelable || closing) return
        event.preventDefault()
        setClosing(true)
      }}
      // The dimmed card around the panel is the dialog itself.
      onClick={(event) => event.target === event.currentTarget && leave()}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) event.currentTarget.close()
      }}
      onClose={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="ab-trailer-panel">
        <div className="ab-trailer-bar">
          <button type="button" className="ab-btn" onClick={leave}>
            Close
          </button>
          <h3 id="ab-trailer-title" className="ab-trailer-title">
            <small>Trailer</small> <span>{title}</span>
          </h3>
          <a className="ab-btn ab-btn-ink" href={watchOf(id)} target="_blank" rel="noopener">
            Open on YouTube
          </a>
        </div>
        {/* Its box is 16:9 from the first frame, so nothing moves as the video arrives. The site's
            address goes to YouTube as the referrer, the origin alone, which YouTube asks of an
            embed; no sandbox, which would keep the player from working. */}
        <div className="ab-trailer-frame">
          <iframe
            src={src}
            title={`Trailer: ${title}`}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
    </dialog>
  )
}
