import { createContext } from 'react'

/** Where the lab's boxes go: after the site's footer on the stage (see SiteFrame, LabBoxes). */
export const AfterHost = createContext<Element | null>(null)
