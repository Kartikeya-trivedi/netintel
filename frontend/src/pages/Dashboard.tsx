import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { Severity } from '../api/types'
import { EmptyPanel, Legend, PageHeader, Panel, Spinner } from '../components/Instrument'
import { useCase } from '../lib/CaseContext'
import { useAsync } from '../lib/useApi'

const SEVERITY_DOT: Record<Severity, string> = {
  low: 'bg-sev-low',
  medium: 'bg-sev-medium',
  high: 'bg-sev-high',
}

/** Case overview: the counts that describe the case, the brokers the graph
 *  ranks highest, and whatever the detection pass has raised. */
export default function Dashboard() {
  const { activeCase, version } = useCase()
  const caseId = activeCase?.id ?? null

  const stats = useAsync(() => api.caseStats(caseId!), [caseId, version], { enabled: caseId !== null })
  const players = useAsync(() => api.getKeyPlayers(caseId!, 'betweenness', 5), [caseId, version], {
    enabled: caseId !== null,
  })
  const alerts = useAsync(() => api.listAlerts(caseId!), [caseId, version], { enabled: caseId !== null })

  if (caseId === null) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
        <EmptyPanel title="No case loaded">
          Reset the demo case from the Sources tab to load Operation Nightfall.
        </EmptyPanel>
      </div>
    )
  }

  const cells = stats.data
    ? [
        { label: 'Entities', value: stats.data.entities },
        { label: 'Links', value: stats.data.relationships },
        { label: 'Sources', value: stats.data.documents },
        { label: 'Transactions', value: stats.data.transactions },
        { label: 'Call events', value: stats.data.comm_events },
        { label: 'Open signals', value: stats.data.open_alerts, accent: true },
      ]
    : []

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
      <PageHeader eyebrow="Case" title={activeCase?.name ?? '—'}>
        {activeCase?.description}
      </PageHeader>

      {stats.loading && (
        <div className="mt-6">
          <Spinner label="Reading case" />
        </div>
      )}

      {/* Counts sit in one ruled strip so they read as a single instrument face
          rather than six numbers floating on the ground. */}
      {stats.data && (
        <div className="bezel mt-6 grid grid-cols-2 border hairline sm:grid-cols-3 lg:grid-cols-6">
          {cells.map((cell) => (
            <div
              key={cell.label}
              className="border-b border-r hairline px-4 py-3.5 last:border-r-0 sm:[&:nth-child(3n)]:border-r-0 lg:border-b-0 lg:[&:nth-child(3n)]:border-r lg:[&:last-child]:border-r-0"
            >
              <Legend>{cell.label}</Legend>
              <p
                className={`readout mt-2 text-[26px] leading-none ${
                  cell.accent ? 'text-signal' : 'text-ink-100'
                }`}
              >
                {cell.value}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Ranked by brokerage"
          aside={<Legend className="readout">betweenness</Legend>}
        >
          <ol className="stagger divide-y divide-rule">
            {(players.data ?? []).map((player) => (
              <li key={player.entity_id} className="flex items-baseline gap-3 px-4 py-2.5">
                <span className="readout w-5 shrink-0 text-[10px] text-ink-700">
                  {String(player.rank).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-200">{player.name}</span>
                {/* A bar makes the gap between the top broker and the rest
                    legible at a glance; the number alone does not. */}
                <span className="hidden h-1 w-20 shrink-0 bg-ink-900 sm:block">
                  <span
                    className="sweep block h-full bg-signal/70"
                    style={{ width: `${Math.max(2, player.score * 100)}%` }}
                  />
                </span>
                <span className="readout w-11 shrink-0 text-right text-xs text-signal-dim">
                  {player.score.toFixed(3)}
                </span>
              </li>
            ))}
          </ol>
          {players.loading && (
            <div className="px-4 py-4">
              <Spinner label="Ranking" />
            </div>
          )}
          <div className="border-t hairline px-4 py-2.5">
            <Link
              to="/graph"
              className="font-cond text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400 transition-colors hover:text-signal"
            >
              Open the network →
            </Link>
          </div>
        </Panel>

        <Panel
          title="Signals"
          aside={
            <Legend className="readout">{alerts.data ? alerts.data.length : '—'}</Legend>
          }
        >
          {alerts.loading && (
            <div className="px-4 py-4">
              <Spinner label="Reading signals" />
            </div>
          )}

          {alerts.data && alerts.data.length === 0 && (
            <div className="px-4 py-6">
              <p className="text-sm leading-relaxed text-ink-500">
                Nothing in this case has tripped a threshold. Transaction spikes,
                structuring patterns, and communication bursts land here as records are
                ingested.
              </p>
            </div>
          )}

          {alerts.data && alerts.data.length > 0 && (
            <ol className="stagger divide-y divide-rule">
              {alerts.data.slice(0, 5).map((alert) => (
                <li key={alert.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 ${SEVERITY_DOT[alert.severity]}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-200">
                    {alert.title}
                  </span>
                  <span className="readout shrink-0 text-[10px] text-ink-700">
                    {alert.severity}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className="border-t hairline px-4 py-2.5">
            <Link
              to="/alerts"
              className="font-cond text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400 transition-colors hover:text-signal"
            >
              Open the feed →
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  )
}
