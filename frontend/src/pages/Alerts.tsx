import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Severity } from '../api/types'
import SignalQueue from '../components/signals/SignalQueue'
import SignalReader from '../components/signals/SignalReader'
import { EmptyState, ErrorNote, LoadingState } from '../ui'
import { CountTab } from '../ui/Identity'
import { useCase } from '../lib/CaseContext'
import { useScopedAsync } from '../lib/useApi'

type Filter = 'all' | Severity
const ORDER = { high: 0, medium: 1, low: 2 }

export default function Alerts() {
  const { activeCase, version } = useCase()
  const navigate = useNavigate()
  const caseId = activeCase?.id ?? null
  const [filter, setFilter] = useState<Filter>('all')
  const [selection, setSelection] = useState<{
    caseId: number
    id: number
  } | null>(null)
  const [reading, setReading] = useState(false)
  const alerts = useScopedAsync(
    () => api.listAlerts(caseId!),
    `signals:${caseId}`,
    [version],
    { enabled: caseId !== null },
  )
  const visible = useMemo(
    () =>
      (alerts.data ?? [])
        .filter((alert) => filter === 'all' || alert.severity === filter)
        .slice()
        .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.id - a.id),
    [alerts.data, filter],
  )
  const counts = useMemo(() => {
    const result = { all: alerts.data?.length ?? 0, high: 0, medium: 0, low: 0 }
    for (const alert of alerts.data ?? []) result[alert.severity] += 1
    return result
  }, [alerts.data])
  const selected =
    visible.find(
      (alert) => selection?.caseId === caseId && alert.id === selection.id,
    ) ??
    visible[0] ??
    null
  const openCount = (alerts.data ?? []).filter(
    (alert) => alert.status === 'open',
  ).length
  useEffect(() => {
    if (
      !reading ||
      selection?.caseId !== caseId ||
      !window.matchMedia('(max-width: 1023px)').matches
    )
      return
    const reader = document.getElementById('signal-reader')
    reader?.focus({ preventScroll: true })
    reader?.scrollIntoView({ block: 'start' })
  }, [reading, selection, caseId])
  function backToQueue() {
    setReading(false)
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          `.signal-row[data-signal="${selected?.id}"]`,
        )
        ?.focus(),
    )
  }
  if (caseId === null)
    return (
      <div className="page-wrap">
        <EmptyState title="No case loaded">
          Load the synthetic demo from Sources to inspect its signals.
        </EmptyState>
      </div>
    )
  const filters: { value: Filter; label: string; tone?: string }[] = [
    { value: 'all', label: 'All events' },
    { value: 'high', label: 'High', tone: 'var(--color-sev-high)' },
    { value: 'medium', label: 'Medium', tone: 'var(--color-sev-medium)' },
    { value: 'low', label: 'Low', tone: 'var(--color-sev-low)' },
  ]
  return (
    <div
      className="signals-workspace"
      data-reading={reading && selection?.caseId === caseId}
    >
      <header className="signals-heading">
        <div>
          <h1>Signals</h1>
          <p>Events that stand out in the case records.</p>
        </div>
        <div className="signal-distribution">
          <div>
            <strong>{openCount}</strong>
            <span>open for review</span>
          </div>
          <div
            className="distribution-track"
            role="img"
            aria-label={`${counts.high} high, ${counts.medium} medium, ${counts.low} low priority`}
          >
            {(['high', 'medium', 'low'] as const).map(
              (level) =>
                counts[level] > 0 && (
                  <span
                    key={level}
                    className={`distribution-${level}`}
                    style={{ flex: counts[level] }}
                  />
                ),
            )}
          </div>
          <p>
            {counts.high} high<span>{counts.medium} medium</span>
            <span>{counts.low} low</span>
          </p>
        </div>
      </header>
      <div className="signals-toolbar">
        <div className="count-tabs" role="group" aria-label="Filter signals">
          {filters.map((item) => (
            <CountTab
              key={item.value}
              label={item.label}
              count={counts[item.value]}
              active={filter === item.value}
              tone={item.tone}
              onClick={() => {
                setFilter(item.value)
                setReading(false)
              }}
            />
          ))}
        </div>
        <span className="signals-result-count">{visible.length} events</span>
      </div>
      {alerts.loading && <LoadingState label="Reading signals" />}
      {alerts.error && <ErrorNote message={alerts.error} />}
      {alerts.data?.length === 0 && (
        <EmptyState title="No signals raised">
          No detection threshold has been crossed in this case.
        </EmptyState>
      )}
      {Boolean(alerts.data?.length) && (
        <div className="signal-desk">
          <SignalQueue
            alerts={visible}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              setSelection({ caseId, id })
              setReading(true)
            }}
          />
          {selected ? (
            <SignalReader
              key={selected.id}
              alert={selected}
              onBack={backToQueue}
              onInspect={() => navigate('/graph')}
            />
          ) : (
            <div className="signal-reader signal-reader-empty">
              <EmptyState title={`No ${filter} signals`}>
                Select another priority to inspect the remaining events.
              </EmptyState>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
