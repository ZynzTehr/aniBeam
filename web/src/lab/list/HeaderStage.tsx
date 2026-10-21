import { IntroHero } from '../../components/IntroHero.tsx'
import { useMeasured } from './hosts.ts'
import { POOL } from './pool.ts'
import { listedIds, useList } from './sandbox.ts'
import { LINKS } from './links.ts'
import { SiteFrame } from './SiteFrame.tsx'
import type { Options } from './switches.ts'

// The intro's buttons once My List is real (PR 3): the fourth a link, no Soon.
const ACTIONS = [
  { href: '#ab-trending', label: 'See what’s trending' },
  { href: '#pull', label: 'Pull a random title' },
  { href: '#decades', label: 'Browse by decade' },
  { href: '/list', label: 'My List' },
]

/**
 * Section 4: the site's own header and intro on Discover, with My List as a link everywhere it
 * said Soon: the header (the intro's buttons dock there from 900px), the phone menu (with
 * マイリスト), and the intro's fourth button. Then D12: the docked links with no count and with
 * one, side by side, measured, so the shift a count makes shows.
 */
export function HeaderStage({ options }: { options: Options }) {
  return (
    <SiteFrame options={options} onMyList={false}>
      {() => (
        <>
          <main id="main">
            <IntroHero titles={POOL.slice(0, 9)} actions={ACTIONS} />
            <Compare />
          </main>
        </>
      )}
    </SiteFrame>
  )
}

/** D12: the header's links as they dock, without and with a count, and how far the count moves. */
function Compare() {
  const count = listedIds(useList()).length
  const shift = useMeasured(
    () => {
      const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
      const span = (row: string) =>
        (box(`#${row} a[href="/list"]`)?.right ?? 0) - (box(`#${row} a`)?.left ?? 0)
      const wide = (row: string) => box(`#${row} a[href="/list"]`)?.width ?? 0
      return {
        link: Math.round(wide('ab-lab-count') - wide('ab-lab-plain')),
        nav: Math.round(span('ab-lab-count') - span('ab-lab-plain')),
      }
    },
    [count],
    { link: 0, nav: 0 },
  )
  const row = (id: string, withCount: boolean) => (
    <nav
      id={id}
      className="ab-nav ab-lab-docked"
      aria-label={withCount ? 'With a count' : 'No count'}
    >
      {LINKS.map(({ href, label }) => (
        <a key={href} href={href} data-lab="" onClick={(event) => event.preventDefault()}>
          {label}
          {withCount && href === '/list' && (
            <span className="ab-lab-count">
              <span className="sr-only">, </span>
              {count}
            </span>
          )}
        </a>
      ))}
    </nav>
  )
  return (
    <section className="ab-lab-compare" aria-labelledby="ab-lab-d12">
      <h2 id="ab-lab-d12" className="ab-lab-legend">
        D12: the docked links, without and with a count
      </h2>
      <div className="ab-lab-compare-row">
        <div>
          <p className="ab-lab-why">
            <b>No count</b> (recommended)
          </p>
          {row('ab-lab-plain', false)}
        </div>
        <div>
          <p className="ab-lab-why">
            <b>“My List {count}”</b>
          </p>
          {row('ab-lab-count', true)}
        </div>
      </div>
      <p className="ab-lab-why" aria-live="polite">
        With {count} on the list, the count makes My List {shift.link}px wider, so the links take{' '}
        {shift.nav}px more, and each change in the count can move them again. The intro’s dock lines
        its buttons up with these links by their measured places.
      </p>
    </section>
  )
}
