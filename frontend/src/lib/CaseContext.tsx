import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { api } from '../api/client'
import type { Case } from '../api/types'
import { useAsync } from './useApi'

interface CaseContextValue {
  cases: Case[]
  activeCase: Case | null
  setActiveCaseId: (id: number) => void
  loading: boolean
  error: string | null
  reload: () => void
  /** Bumped by reload(). Views put this in their dependency list so a demo
   *  reset refetches them too -- the case id does not change across a reset,
   *  so without it the graph and the counts keep showing the old case. */
  version: number
}

const CaseContext = createContext<CaseContextValue | null>(null)

export function CaseProvider({
  children,
  enabled = true,
}: {
  children: ReactNode
  enabled?: boolean
}) {
  const [activeId, setActiveCaseId] = useState<number | null>(null)
  const [version, setVersion] = useState(0)
  // Keep the selected case when returning through the public page, without
  // fetching private case data for a visitor who has only opened that page.
  const {
    data,
    error,
    loading,
    reload: reloadCases,
  } = useAsync(() => api.listCases(), [], { enabled })

  const reload = useCallback(() => {
    reloadCases()
    setVersion((current) => current + 1)
  }, [reloadCases])

  const value = useMemo<CaseContextValue>(() => {
    const cases = data ?? []
    // Fall back to the first case so the console is never empty on load.
    const activeCase = cases.find((c) => c.id === activeId) ?? cases[0] ?? null
    return {
      cases,
      activeCase,
      setActiveCaseId,
      loading,
      error,
      reload,
      version,
    }
  }, [data, activeId, loading, error, reload, version])

  return <CaseContext.Provider value={value}>{children}</CaseContext.Provider>
}

export function useCase(): CaseContextValue {
  const context = useContext(CaseContext)
  if (context === null) {
    throw new Error('useCase must be used inside a CaseProvider')
  }
  return context
}
