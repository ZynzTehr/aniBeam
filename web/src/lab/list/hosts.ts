// The lab draws the site's own components, unchanged, and puts what a choice adds into them: an
// element of its own placed in the component's markup, which React then draws into (a portal).
// So the card, the covers and the header are the real ones, never copies, and a component that
// draws again keeps what the lab placed: React leaves alone what it didn't make.
import { useLayoutEffect, useState, useSyncExternalStore } from 'react'

/** Where to place a host: in `parent`, before `before` (or last). */
export type Place = { parent: Element; before?: Node | null }

/**
 * An element of the lab's own, with `className`, placed where `find` says while `key` stays the
 * same, and placed again when it changes. Until it is placed, what is drawn into it isn't shown.
 */
export function useHost(find: () => Place | null, key: unknown, className = ''): HTMLElement {
  const [host] = useState(() => document.createElement('div'))
  useLayoutEffect(() => {
    const place = find()
    if (!place) return
    host.className = className
    place.parent.insertBefore(host, place.before ?? null)
    return () => host.remove()
    // find reads the page as it is: only key says when to read it again.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [host, key, className])
  return host
}

/** A host in an element of a component, with the title id its link names. */
export type Slot = { id: number; host: HTMLElement; item: Element }

/** The slots made last, for React to read as an outside store (see useSlots). */
function slotStore() {
  let slots: Slot[] = []
  const listeners = new Set<() => void>()
  return {
    get: () => slots,
    set(next: Slot[]) {
      slots = next
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

/**
 * A host in every element `selector` finds under `root`, placed last in it, with the title its
 * link to /anime/:id names. `refresh` changes whenever the component may have drawn other
 * elements (new titles, a new layout), so they get hosts too.
 */
export function useSlots(
  root: Element | null,
  selector: string,
  refresh: unknown,
  className = '',
): Slot[] {
  const [store] = useState(slotStore)
  useLayoutEffect(() => {
    if (!root) return
    const made: Slot[] = []
    for (const item of root.querySelectorAll(selector)) {
      const link = item.matches('a') ? item : item.querySelector('a[href^="/anime/"]')
      const id = Number(link?.getAttribute('href')?.match(/^\/anime\/(\d+)$/)?.[1])
      if (!id) continue
      const host = document.createElement('span')
      host.className = className
      item.append(host)
      made.push({ id, host, item })
    }
    store.set(made)
    return () => {
      made.forEach(({ host }) => host.remove())
      store.set([])
    }
  }, [store, root, selector, refresh, className])
  return useSyncExternalStore(store.subscribe, store.get)
}
