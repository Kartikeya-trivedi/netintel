import { Link } from 'react-router-dom'

import { api } from '../api/client'
import { Empty, Legend, Panel, Readout, Spinner } from '../components/Instrument'
import { useCase } from '../lib/CaseContext'
import { useAsync } from '../lib/useApi'

/** Case overview. The alert feed and network preview land in phase 5; the
 *  counts are live so the nav never shows a dead placeholder. */
export default function Dashboard() {
  const { activeCase } = useCase()
  const caseId = activeCase?.id ?? null

  const stats = useAsync(() => api.caseStats(caseId!), [caseId], { enabled: caseId !== null })
  const players = useAsync(() => api.getKeyPlayers(caseId!, 'betweenness', 5), [caseId], {
    enabled: caseId !== null,
  })

  if (caseId === null) {
    return <Empty>No case loaded. Reset the demo case from the Sources tab.</Empty>
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="border-b hairline pb-5">
        <Legend>Case</Legend>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-ink-100">
          {activeCase?.name}
        </h1>
        {activeCase?.description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500">
            {activeCase.description}
          </p>
        )}
      </header>

      {stats.loading && <div className="mt-6"><Spinner label="Reading case" /></div>}

      {stats.data && (
        <div className="mt-7 grid grid-cols-2 gap-x-10 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">
          <Readout label="Entities" value={stats.data.entities} />
          <Readout label="Links" value={stats.data.relationships} />
          <Readout label="Sources" value={stats.data.documents} />
          <Readout label="Transactions" value={stats.data.transactions} />
          <Readout label="Call events" value={stats.data.comm_events} />
          <Readout label="Open signals" value={stats.data.open_alerts} accent />
        </div>
      )}

      <div className="mt-9 grid gap-5 lg:grid-cols-2">
        <Panel title="Ranked by brokerage">
          <ol className="divide-y divide-white/[0.06]">
            {(players.data ?? []).map((player) => (
              <li key={player.entity_id} className="flex items-baseline gap-3 px-4 py-2.5">
                <span className="readout w-5 text-[10px] text-ink-700">
                  {String(player.rank).padStart(2, '0')}
                </span>
                <span className="flex-1 truncate text-sm text-ink-200">{player.name}</span>
                <span className="readout text-xs text-signal-dim">
                  {player.score.toFixed(3)}
                </span>
              </li>
            ))}
          </ol>
          <div className="border-t hairline px-4 py-2.5">
            <Link
              to="/graph"
              className="font-cond text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400 transition-colors hover:text-signal"
            >
              Open the network →
            </Link>
          </div>
        </Panel>

        <Panel title="Signals">
          <div className="px-4 py-6">
            <p className="text-sm leading-relaxed text-ink-500">
              Transaction spikes, structuring patterns, and communication bursts
              arrive with the anomaly engine in phase 5.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  )
}
