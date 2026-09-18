import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import { ApiError } from '../../api/client'
import { errorMessage } from '../../lib/format'

/** Recording analyst decisions.
 *
 *  Every decision names the workspace version the investigator last saw. If
 *  anyone else decided in between, the server refuses with 409 and nothing is
 *  written; the view then says so and reloads rather than retrying blind. A
 *  single action may need several calls (one per disputed passage), so the
 *  version is threaded through them and a partial run is reported as such.
 */

export type DecisionStep = (expectedVersion: number) => Promise<{ version: number }>

export interface DecisionResult {
  ok: boolean
  conflict: boolean
  version: number | null
  recorded: number
  total: number
  message: string
}

export interface RecordedDecision {
  summary: string
  version: number
  at: number
}

interface DecisionContextValue {
  workspaceId: number
  /** The version the investigator is looking at; null while it loads. */
  version: number | null
  busy: boolean
  record: (summary: string, steps: DecisionStep[]) => Promise<DecisionResult>
}

const DecisionContext = createContext<DecisionContextValue | null>(null)

export function DecisionProvider({
  workspaceId,
  version: reported,
  onRecorded,
  onChanged,
  children,
}: {
  workspaceId: number
  /** The workspace version as last fetched; null while it loads. */
  version: number | null
  onRecorded: (decision: RecordedDecision) => void
  /** Refetch whatever the decision may have changed. */
  onChanged: () => void
  children: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  // The version our own last decision produced, tied to the workspace version
  // it was made on. It bridges the moment between a decision and the refetch
  // that reports it; once the refetch lands (or anything else changes the
  // workspace version) the server's figure is used again.
  const [own, setOwn] = useState<{ base: number | null; version: number } | null>(null)
  const version = own && own.base === reported ? own.version : reported

  const record = useCallback(
    async (summary: string, steps: DecisionStep[]): Promise<DecisionResult> => {
      if (version === null) {
        return {
          ok: false,
          conflict: false,
          version: null,
          recorded: 0,
          total: steps.length,
          message: 'The workspace is still loading; try again in a moment.',
        }
      }
      setBusy(true)
      let expected = version
      let recorded = 0
      try {
        for (const step of steps) {
          const out = await step(expected)
          expected = out.version
          recorded += 1
        }
        setOwn({ base: reported, version: expected })
        onRecorded({ summary, version: expected, at: Date.now() })
        return { ok: true, conflict: false, version: expected, recorded, total: steps.length, message: '' }
      } catch (error) {
        const conflict = error instanceof ApiError && error.status === 409
        const prefix =
          recorded > 0 ? `Recorded ${recorded} of ${steps.length} before stopping. ` : 'Nothing was recorded. '
        return {
          ok: false,
          conflict,
          version: recorded > 0 ? expected : null,
          recorded,
          total: steps.length,
          message: conflict
            ? `${prefix}Workspace moved on since you loaded it; reload and decide again. The latest state is loading now.`
            : `${prefix}${errorMessage(error)}`,
        }
      } finally {
        setBusy(false)
        // A conflict means the screen is out of date; a partial run changed
        // things. Either way what is on screen is no longer the record.
        onChanged()
      }
    },
    [version, reported, onRecorded, onChanged],
  )

  const value = useMemo(() => ({ workspaceId, version, busy, record }), [workspaceId, version, busy, record])
  return <DecisionContext.Provider value={value}>{children}</DecisionContext.Provider>
}

export function useDecisions(): DecisionContextValue {
  const context = useContext(DecisionContext)
  if (context === null) throw new Error('useDecisions must be used inside a DecisionProvider')
  return context
}
