import { useCallback, useEffect, useRef, useState } from 'react'

/** Minimal async-resource hook.
 *
 *  Deliberately not a data-fetching library: the app has a handful of
 *  endpoints and no cache-invalidation story worth the dependency. The stale
 *  guard matters though -- switching entities fast enough would otherwise let
 *  a slow earlier response overwrite a newer one.
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const generation = useRef(0)

  const run = useCallback(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    const current = ++generation.current
    setLoading(true)
    setError(null)

    fetcher()
      .then((result) => {
        if (current === generation.current) setData(result)
      })
      .catch((err: unknown) => {
        if (current === generation.current) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (current === generation.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  useEffect(run, [run])

  return { data, error, loading, reload: run }
}
