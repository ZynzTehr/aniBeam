// DRAFT PROTOTYPE (never merged): the intro's buttons fly into the header as it reaches them.
// ?nav=a: scroll-linked, each button travels with the scroll into its header slot.
// ?nav=b: dock, the buttons fly up in one quick move as the header reaches them, and back down.
// Phones (under 900px): the header hides while scrolling down and slides back in on a scroll up,
// with the links once the intro's buttons have scrolled away.
import { useEffect } from 'react'
import { reducedMotion } from '../lib/motion.ts'
import './nav-proto.css'

const navProto = new URLSearchParams(location.search).get('nav')

const SHORT: Record<string, string> = {
  '#ab-trending': 'Trending',
  '#pull': 'Pull',
  '#decades': 'Decades',
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const ease = (t: number) => 1 - Math.pow(1 - t, 3)

/** `active`: the intro's buttons are on the page (not while searching, say). */
export function NavFlight({ active }: { active: boolean }) {
  useEffect(() => {
    if (navProto !== 'a' && navProto !== 'b') return
    const root = document.documentElement
    root.dataset.navProto = navProto
    const setDocked = (docked: boolean) => {
      if (docked) root.dataset.docked = ''
      else delete root.dataset.docked
    }
    if (!active) {
      setDocked(true)
      return () => {
        delete root.dataset.navProto
        setDocked(false)
      }
    }
    const header = document.querySelector<HTMLElement>('.ab-top')!
    const intro = [...document.querySelectorAll<HTMLAnchorElement>('.ab-intro-actions a')]
    const slots = intro.map((a) =>
      document.querySelector<HTMLAnchorElement>(`.ab-nav a[href="${a.getAttribute('href')}"]`),
    )
    const layer = document.body.appendChild(document.createElement('div'))
    layer.className = 'ab-fly-layer'
    layer.setAttribute('aria-hidden', 'true')
    const clones = intro.map((a) => {
      const clone = layer.appendChild(document.createElement('span'))
      clone.className = 'ab-fly'
      clone.textContent = a.textContent
      return clone
    })
    const wide = matchMedia('(min-width: 900px)')
    let docked = false
    let flying: Animation[] = []
    let lastY = scrollY
    let frame = 0

    const show = (el: HTMLElement | null, visible: boolean) => {
      if (el) el.style.visibility = visible ? '' : 'hidden'
    }
    const restAt = (isDocked: boolean) => {
      docked = isDocked
      setDocked(isDocked)
      intro.forEach((a) => show(a, true))
      slots.forEach((s) => show(s, true))
      clones.forEach((c) => (c.style.display = 'none'))
    }
    const place = (clone: HTMLElement, from: DOMRect, to: DOMRect, t: number, a: HTMLElement) => {
      const fs = parseFloat(getComputedStyle(a).fontSize)
      clone.style.display = 'inline-flex'
      clone.style.left = `${lerp(from.left, to.left, t)}px`
      clone.style.top = `${lerp(from.top, to.top, t)}px`
      clone.style.width = `${lerp(from.width, to.width, t)}px`
      clone.style.height = `${lerp(from.height, to.height, t)}px`
      clone.style.fontSize = `${lerp(fs, fs * 0.94, t)}px`
      const short = t > 0.55
      clone.textContent = short ? (SHORT[a.getAttribute('href')!] ?? a.textContent) : a.textContent
      // Landing in the header on the section the visitor is in, it arrives in its active look.
      const slot = slots[intro.indexOf(a as HTMLAnchorElement)]
      clone.classList.toggle('is-current', short && slot?.hasAttribute('aria-current') === true)
    }

    // A: scroll-linked. Progress runs from the buttons' top 220px below the header to the header.
    const frameA = () => {
      const bottom = header.getBoundingClientRect().bottom
      const top = Math.min(...intro.map((a) => a.getBoundingClientRect().top))
      const p = Math.min(1, Math.max(0, 1 - (top - bottom) / 220))
      if (reducedMotion() || p === 0 || p === 1) return restAt(p === 1)
      setDocked(true)
      intro.forEach((a, i) => {
        show(a, false)
        show(slots[i], false)
        place(clones[i], a.getBoundingClientRect(), slots[i]!.getBoundingClientRect(), ease(p), a)
      })
    }

    // B: dock. Docks as the header reaches the buttons; undocks only once their place in the intro
    // is well into view again (UNDOCK px below the header), so they fly back down into it.
    const UNDOCK = 200
    const fly = (toHeader: boolean) => {
      flying.forEach((f) => f.cancel())
      if (reducedMotion()) return restAt(toHeader)
      setDocked(true)
      docked = toHeader
      flying = intro.map((a, i) => {
        const from = (toHeader ? a : slots[i]!).getBoundingClientRect()
        const to = (toHeader ? slots[i]! : a).getBoundingClientRect()
        show(a, false)
        show(slots[i], false)
        place(clones[i], to, to, toHeader ? 1 : 0, a)
        const dx = from.left - to.left
        const dy = from.top - to.top
        const sx = from.width / to.width
        const sy = from.height / to.height
        return clones[i].animate(
          [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'none' }],
          {
            duration: 420,
            delay: i * 45,
            easing: 'cubic-bezier(0.2, 1.35, 0.35, 1)',
            fill: 'backwards',
          },
        )
      })
      void Promise.all(flying.map((f) => f.finished)).then(
        () => restAt(toHeader),
        () => {},
      )
    }
    const frameB = () => {
      const bottom = header.getBoundingClientRect().bottom
      const top = Math.min(...intro.map((a) => a.getBoundingClientRect().top))
      if (!docked && top <= bottom) fly(true)
      else if (docked && top > bottom + UNDOCK) fly(false)
    }

    // Phones: the header hides on the way down and comes back on the way up; the links join it
    // once the buttons have scrolled off the top.
    const framePhone = () => {
      const y = scrollY
      const away = y > header.offsetHeight && y > lastY
      if (Math.abs(y - lastY) > 6) {
        if (away) root.dataset.headerAway = ''
        else delete root.dataset.headerAway
        lastY = y
      }
      const bottom = Math.max(...intro.map((a) => a.getBoundingClientRect().bottom))
      restAt(bottom < 0)
    }

    // The section the visitor is in: the last whose top has passed a line two thirds of the way
    // down the screen below the header, so a section counts once it is well in view. Its link in
    // the header shows its active look (aria-current).
    const sections = ['#ab-trending', '#pull', '#decades']
    const spy = () => {
      const line =
        header.getBoundingClientRect().bottom + ((innerHeight - header.offsetHeight) * 2) / 3
      let current: string | null = null
      for (const id of sections) {
        const section = document.querySelector(id)
        if (section && section.getBoundingClientRect().top <= line) current = id
      }
      for (const link of document.querySelectorAll<HTMLAnchorElement>('.ab-nav a[href^="#"]')) {
        if (link.getAttribute('href') === current) link.setAttribute('aria-current', 'location')
        else link.removeAttribute('aria-current')
      }
    }

    const update = () => {
      frame = 0
      spy()
      if (!wide.matches) return framePhone()
      delete root.dataset.headerAway
      if (navProto === 'a') frameA()
      else frameB()
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('resize', onScroll)
    update()
    return () => {
      removeEventListener('scroll', onScroll)
      removeEventListener('resize', onScroll)
      cancelAnimationFrame(frame)
      flying.forEach((f) => f.cancel())
      layer.remove()
      intro.forEach((a) => show(a, true))
      slots.forEach((s) => show(s, true))
      delete root.dataset.navProto
      delete root.dataset.headerAway
      setDocked(false)
      for (const link of document.querySelectorAll('.ab-nav a[aria-current="location"]'))
        link.removeAttribute('aria-current')
    }
  }, [active])
  return null
}
