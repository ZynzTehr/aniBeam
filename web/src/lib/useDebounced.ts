import { useEffect, useState } from 'react'

/**
 * The value, once it has stopped changing for `ms` milliseconds; or at once, as it renders, when
 * `now` says it needn't wait (an emptied search box, say).
 */
export function useDebounced<T>(value: T, ms: number, now?: (value: T) => boolean): T {
  const [debounced, setDebounced] = useState(value)
  if (now?.(value) && !Object.is(debounced, value)) setDebounced(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}
