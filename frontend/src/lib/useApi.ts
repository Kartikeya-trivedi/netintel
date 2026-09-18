import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'

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

type Scoped<T> =
  | { scope: string; ok: true; value: T }
  | { scope: string; ok: false; error: string; status: number | null }

/** useAsync for answers that belong to a question: who is asking, about which
 *  workspace, about which finding.
 *
 *  A result only shows while its scope is still the current one, so switching
 *  demo identity or finding never leaves the previous answer on screen under
 *  the new question -- which matters when the new identity may not be allowed
 *  to see it. Refetches inside one scope (after a decision) keep the old answer
 *  up until the new one lands, so the page does not blank on every change.
 */
export function useScopedAsync<T>(
  fetcher: () => Promise<T>,
  scope: string,
  deps: unknown[],
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true
  const state = useAsync<Scoped<T>>(
    () =>
      fetcher().then(
        (value): Scoped<T> => ({ scope, ok: true, value }),
        (err: unknown): Scoped<T> => ({
          scope,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          status: err instanceof ApiError ? err.status : null,
        }),
      ),
    [scope, ...deps],
    { enabled },
  )

  const result = enabled && state.data !== null && state.data.scope === scope ? state.data : null
  return {
    data: result && result.ok ? result.value : null,
    error: result && !result.ok ? result.error : null,
    status: result && !result.ok ? result.status : null,
    loading: enabled && (state.loading || result === null),
    reload: state.reload,
  }
}
