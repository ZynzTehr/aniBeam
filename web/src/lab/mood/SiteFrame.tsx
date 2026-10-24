import { useEffect, useState, type ReactNode } from 'react'
import { SiteHeader, type NavLink } from '../../components/SiteHeader.tsx'

/**
 * The site's own header and footer around a section of the lab. A link that would leave the lab (a
 * section of Discover, the logo, My List) says where it goes on the site instead, in a notice; a
 * title's link opens its card. Typing in the search says where its results would show.
 */
export function SiteFrame({
  links,
  currentHref,
  onSearch,
  children,
}: {
  links: NavLink[]
  currentHref?: string | null
  /** What typing in the search does, as a notice; by default the results show on Discover. */
  onSearch?: (term: string) => string
  children: ReactNode
}) {
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const leave = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.('a[href]')
      const href = link?.getAttribute('href') ?? ''
      if (!link || link.getAttribute('target') === '_blank' || /^\/anime\//.test(href)) return
      if (!/^[/#]/.test(href)) return
      event.preventDefault()
      setNotice(`On the site, this goes to ${href.startsWith('#') ? `/${href}` : href}.`)
    }
    document.addEventListener('click', leave, true)
    return () => document.removeEventListener('click', leave, true)
  }, [])
  return (
    <div className="ab-lab-site">
      <SiteHeader
        links={links}
        search={search}
        onSearch={(shown) => {
          setSearch(shown)
          const term = shown.trim()
          if (term.length >= 2)
            setNotice(onSearch?.(term) ?? `The results for “${term}” show on Discover.`)
        }}
        currentHref={currentHref}
      />
      {notice && (
        <p className="ab-lab-notice" role="status">
          {notice}{' '}
          <button type="button" className="ab-lab-see" onClick={() => setNotice('')}>
            OK
          </button>
        </p>
      )}
      {children}
      <footer className="ab-foot">
        <p>Data from AniList. AniBeam is not affiliated with AniList.</p>
      </footer>
    </div>
  )
}
