import type { ReactNode } from 'react'

/** A section heading with a manga sound effect beside it. The effect is decoration only. */
export function SfxHeading({
  as: Heading = 'h2',
  id,
  sfx,
  small = false,
  children,
}: {
  as?: 'h1' | 'h2'
  id: string
  sfx: string
  small?: boolean
  children: ReactNode
}) {
  return (
    <Heading id={id} className={small ? 'ab-sfx ab-sfx-small' : 'ab-sfx'}>
      {children}
      <span aria-hidden="true">{sfx}</span>
    </Heading>
  )
}
