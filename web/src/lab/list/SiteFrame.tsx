import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SiteHeader } from '../../components/SiteHeader.tsx'
import { useHost } from './hosts.ts'
import { LINKS } from './links.ts'
import { listedIds, useList } from './sandbox.ts'
import type { Options } from './switches.ts'
import { WORDS } from './wording.ts'

/**
 * The site's own header around a section of the lab, with what My List adds to it: the phone
 * menu's kana for My List (マイリスト, proposed), and D12's count when it is picked. `onMyList`
 * marks My List as the page on screen, in the header's yellow, as the section links mark theirs.
 * A link that would leave the lab (a section of Discover, the logo) says where it goes instead,
 * in `notice`; so does typing in the search, which D11 sends to Discover or hides on My List.
 */
export function SiteFrame({
  options,
  onMyList,
  children,
}: {
  options: Options
  onMyList: boolean
  children: (say: (notice: string) => void) => ReactNode
}) {
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const count = listedIds(useList()).length
  // Links that would leave the lab: the logo, the section links, a link to Discover.
  useEffect(() => {
    const leave = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.('a[href]')
      const href = link?.getAttribute('href') ?? ''
      if (!link || link.hasAttribute('data-lab') || link.getAttribute('target') === '_blank') return
      if (/^\/anime\//.test(href) || !/^[/#]/.test(href)) return
      event.preventDefault()
      setNotice(`On the site, this goes to ${href.startsWith('#') ? `/${href}` : href}.`)
    }
    document.addEventListener('click', leave, true)
    return () => document.removeEventListener('click', leave, true)
  }, [])
  const kana = useHost(
    () => {
      const item = document.querySelector('#ab-menu a[href="/list"] > span[aria-hidden]')
      return item && { parent: item }
    },
    'kana',
    'ab-lab-contents',
  )
  const badge = useHost(
    () => {
      const link = document.querySelector('.ab-top .ab-nav a[href="/list"]')
      return options.d12 === 'count' && link ? { parent: link } : null
    },
    options.d12,
    'ab-lab-contents',
  )
  const hidden = onMyList && options.d11 === 'hide'
  return (
    <div className={hidden ? 'ab-lab-site ab-lab-nosearch' : 'ab-lab-site'}>
      <SiteHeader
        links={LINKS}
        search={search}
        onSearch={(shown) => {
          setSearch(shown)
          if (shown.trim().length >= 2)
            setNotice(
              onMyList
                ? `D11: typing here goes to Discover, at /, and shows the results for “${shown.trim()}” there, with no reload.`
                : `The results for “${shown.trim()}” show here, on Discover.`,
            )
        }}
        currentHref={onMyList ? '/list' : null}
      />
      {notice && (
        <p className="ab-lab-notice" role="status">
          {notice}{' '}
          <button type="button" className="ab-lab-see" onClick={() => setNotice('')}>
            OK
          </button>
        </p>
      )}
      {children(setNotice)}
      {createPortal(WORDS.kana, kana)}
      {createPortal(
        <span className="ab-lab-count">
          <span className="sr-only">, </span>
          {count}
        </span>,
        badge,
      )}
    </div>
  )
}
