import { isPlainClick } from '../components/plainClick.ts'

/**
 * Whether a click came from a pointer (a mouse, a finger, a pen) rather than a key or a screen
 * reader's default action. Where the click carries a pointerType, that says, '' being a click a
 * key fired (Firefox gives such a click a detail of 1, so detail can't tell). Where it carries
 * none (Safari before its clicks were pointer events), the last input before it decides.
 */
export const byPointer = (pointerType: string | undefined, last: 'pointer' | 'key') =>
  typeof pointerType === 'string' ? pointerType !== '' : last === 'pointer'

/**
 * Marks a section heading that a link focuses after a tap or click (data-jump="pointer"), so the
 * focus ring it shows for the keyboard stays hidden. Safari, and every browser on an iPhone,
 * never focuses a tapped link, so it counts the heading's focus as the keyboard's and showed the
 * ring after a tap. Focus still moves to the heading, for keyboard and screen reader users, and a
 * jump made with Enter keeps its ring. The mark goes as focus leaves the heading. Returns a
 * function that stops listening.
 */
export function markPointerJumps(): () => void {
  let last: 'pointer' | 'key' = 'key'
  const pointed = () => (last = 'pointer')
  const keyed = () => (last = 'key')
  // In the capture phase, so no handler can stop it first; either way before the browser follows
  // the link, which it does once the click has been dispatched.
  const clicked = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href^="#"]')
    if (!link || !isPlainClick(event)) return
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)))
    if (target?.getAttribute('tabindex') !== '-1') return
    if (byPointer((event as PointerEvent).pointerType, last)) target.dataset.jump = 'pointer'
    else delete target.dataset.jump
  }
  const left = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement) delete event.target.dataset.jump
  }
  addEventListener('pointerdown', pointed, true)
  addEventListener('keydown', keyed, true)
  document.addEventListener('click', clicked, true)
  document.addEventListener('focusout', left, true)
  return () => {
    removeEventListener('pointerdown', pointed, true)
    removeEventListener('keydown', keyed, true)
    document.removeEventListener('click', clicked, true)
    document.removeEventListener('focusout', left, true)
  }
}
