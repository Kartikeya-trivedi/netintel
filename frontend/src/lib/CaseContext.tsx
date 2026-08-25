import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

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
}

const CaseContext = createContext<CaseContextValue | null>(null)

export function CaseProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveCaseId] = useState<number | null>(null)
  const { data, error, loading, reload } = useAsync(() => api.listCases(), [])

  const value = useMemo<CaseContextValue>(() => {
    const cases = data ?? []
    // Fall back to the first case so the console is never empty on load.
    const activeCase = cases.find((c) => c.id === activeId) ?? cases[0] ?? null
    return { cases, activeCase, setActiveCaseId, loading, error, reload }
  }, [data, activeId, loading, error, reload])

  return <CaseContext.Provider value={value}>{children}</CaseContext.Provider>
}

export function useCase(): CaseContextValue {
  const context = useContext(CaseContext)
  if (context === null) {
    throw new Error('useCase must be used inside a CaseProvider')
  }
  return context
}
