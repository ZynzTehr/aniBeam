import type { CSSProperties } from 'react'

/** Custom properties (--i, --c, ...) as a React style; React's types only know standard ones. */
export const cssVars = (values: Record<string, string | number>) => values as CSSProperties
