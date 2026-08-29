import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api/client'
import type { Severity } from '../api/types'
import AlertCard from '../components/AlertCard'
import {
  EmptyPanel,
  ErrorNote,
  Legend,
  PageHeader,
  Segmented,
  Spinner,
} from '../components/Instrument'
import { useCase } from '../lib/CaseContext'
import { useAsync } from '../lib/useApi'

type Filter = 'all' | Severity

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

/** Anomaly feed. Transaction spikes, structuring patterns, and communication
 *  bursts raised by the detection pass, newest and most severe first. */
export default function Alerts() {
  const { activeCase } = useCase()
  const navigate = useNavigate()
  const caseId = activeCase?.id ?? null

  const [filter, setFilter] = useState<Filter>('all')

  const alerts = useAsync(() => api.listAlerts(caseId!), [caseId], { enabled: caseId !== null })

  const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

  const visible = useMemo(() => {
    const rows = alerts.data ?? []
    return rows
      .filter((a) => filter === 'all' || a.severity === filter)
      .slice()
      .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.id - a.id)
  }, [alerts.data, filter])

  const openCount = (alerts.data ?? []).filter((a) => a.status === 'open').length

  if (caseId === null) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
        <EmptyPanel title="No case loaded">
          Seed the demo case from the Sources tab to raise signals against it.
        </EmptyPanel>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
      <PageHeader
        eyebrow="Signals"
        title="Anomaly feed"
        aside={
          alerts.data && alerts.data.length > 0 ? (
            <div className="text-right">
              <Legend>Open</Legend>
              <p className="readout mt-1.5 text-2xl leading-none text-signal">{openCount}</p>
            </div>
          ) : undefined
        }
      >
        Transaction spikes, structuring patterns, and communication bursts, ranked by
        severity. Each signal carries the entities and the evidence behind the flag.
      </PageHeader>

      {alerts.data && alerts.data.length > 0 && (
        <div className="mt-5 flex items-center justify-between gap-4">
          <Segmented options={FILTERS} value={filter} onChange={setFilter} />
          <Legend className="readout">
            {visible.length} of {alerts.data.length}
          </Legend>
        </div>
      )}

      {alerts.loading && (
        <div className="mt-6">
          <Spinner label="Reading signals" />
        </div>
      )}

      {alerts.error && (
        <div className="mt-6">
          <ErrorNote message={alerts.error} />
        </div>
      )}

      {alerts.data && alerts.data.length === 0 && (
        <div className="mt-6">
          <EmptyPanel title="No signals raised">
            Nothing in this case has tripped a threshold. Signals appear here as
            transactions, call records, and new links are ingested.
          </EmptyPanel>
        </div>
      )}

      {visible.length > 0 && (
        <div className="stagger mt-5 grid gap-3 lg:grid-cols-2">
          {visible.map((alert) => (
            <AlertCard key={alert.id} alert={alert} onInspect={() => navigate('/graph')} />
          ))}
        </div>
      )}

      {alerts.data && alerts.data.length > 0 && visible.length === 0 && (
        <div className="mt-6">
          <EmptyPanel title={`No ${filter} signals`}>
            Nothing at this severity. Switch the filter to see the rest of the feed.
          </EmptyPanel>
        </div>
      )}
    </div>
  )
}
