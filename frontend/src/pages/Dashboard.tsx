import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Check } from '../ui/Symbols'
import { api } from '../api/client'
import { EmptyState, ErrorNote, LoadingState } from '../ui'
import { useCase } from '../lib/CaseContext'
import { useScopedAsync } from '../lib/useApi'

const NetworkGraph = lazy(() => import('../components/NetworkGraph'))

export default function Dashboard() {
  const { activeCase, version } = useCase()
  const caseId = activeCase?.id ?? null
  const [selected, setSelected] = useState<{
    caseId: number
    id: string
  } | null>(null)
  const selectedId = selected?.caseId === caseId ? selected.id : null
  const caseScope = `case:${caseId}`
  const stats = useScopedAsync(
    () => api.caseStats(caseId!),
    caseScope,
    [version],
    { enabled: caseId !== null },
  )
  const players = useScopedAsync(
    () => api.getKeyPlayers(caseId!, 'betweenness', 5),
    caseScope,
    [version],
    { enabled: caseId !== null },
  )
  const alerts = useScopedAsync(
    () => api.listAlerts(caseId!),
    caseScope,
    [version],
    { enabled: caseId !== null },
  )
  const graph = useScopedAsync(
    () => api.getGraph(caseId!, { entityTypes: ['PERSON', 'ORG'] }),
    caseScope,
    [version],
    { enabled: caseId !== null },
  )
  const network = useMemo(() => {
    if (!graph.data) return null
    const linked = new Set(
      graph.data.edges.flatMap((edge) => [edge.source, edge.target]),
    )
    return {
      ...graph.data,
      nodes: graph.data.nodes.filter((node) => linked.has(node.id)),
    }
  }, [graph.data])
  const focused = network?.nodes.find((node) => node.id === selectedId)
  if (caseId === null)
    return (
      <div className="page-wrap">
        <EmptyState
          title="Open a case to see the connections"
          action={
            <Link className="button button-primary" to="/documents">
              Open Sources
              <ArrowRight size={15} />
            </Link>
          }
        >
          Load the synthetic demo from Sources to explore the people,
          connections, and signals in Operation Nightfall.
        </EmptyState>
      </div>
    )
  const cells = stats.data
    ? [
        { label: 'Entities', value: stats.data.entities },
        { label: 'Connections', value: stats.data.relationships },
        { label: 'Sources', value: stats.data.documents },
        { label: 'Transactions', value: stats.data.transactions },
        { label: 'Call events', value: stats.data.comm_events },
        { label: 'Open signals', value: stats.data.open_alerts },
      ]
    : []

  return (
    <div className="case-overview">
      <header className="case-heading">
        <div>
          <span className="case-kicker">Case overview · Synthetic data</span>
          <h1>{activeCase?.name}</h1>
          <p>{activeCase?.description}</p>
        </div>
        <Link className="button button-primary shrink-0" to="/graph">
          Explore network
          <ArrowUpRight size={16} />
        </Link>
      </header>
      {stats.loading && <LoadingState label="Reading case" />}
      {stats.error && <ErrorNote message={stats.error} />}
      {stats.data && (
        <dl className="case-totals">
          {cells.map((cell) => (
            <div key={cell.label}>
              <dd>{cell.value.toLocaleString()}</dd>
              <dt>{cell.label}</dt>
            </div>
          ))}
        </dl>
      )}
      <div className="overview-spread">
        <section className="network-stage" aria-label="Case network preview">
          <header className="stage-heading">
            <h2>The shape of this case</h2>
            <span className="text-xs text-muted">
              {network
                ? `${network.nodes.length} connected actors`
                : 'Actor network'}
            </span>
          </header>
          <div className="overview-canvas">
            {graph.loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <LoadingState label="Mapping connections" />
              </div>
            )}
            {graph.error && (
              <div className="p-5">
                <ErrorNote message={graph.error} />
              </div>
            )}
            {network && network.nodes.length > 0 && (
              <Suspense
                fallback={
                  <div className="p-5">
                    <LoadingState label="Opening network" />
                  </div>
                }
              >
                <NetworkGraph
                  data={network}
                  sizeBy="betweenness"
                  colorBy="community"
                  selectedId={selectedId}
                />
              </Suspense>
            )}
            {network?.nodes.length === 0 && (
              <div className="p-6">
                <EmptyState title="No connected actors yet">
                  Add source records to build the actor network.
                </EmptyState>
              </div>
            )}
          </div>
          <footer className="stage-footer">
            <div>
              <p className="text-xs font-semibold text-heading">
                {focused
                  ? focused.label
                  : 'Size shows brokerage. Colour shows community.'}
              </p>
              <p className="mt-1 text-xs text-muted">
                {focused
                  ? 'Selected from the ranking. Open Network to inspect the evidence.'
                  : 'Drag to explore · Scroll to zoom'}
              </p>
            </div>
            <Link to="/graph" className="button button-link">
              Inspect connections
              <ArrowRight size={15} />
            </Link>
          </footer>
        </section>
        <aside className="reading-list" aria-label="People ranked by brokerage">
          <header className="stage-heading">
            <div>
              <h2>People to inspect</h2>
              <p className="mt-1 text-xs text-muted">Ranked by betweenness</p>
            </div>
          </header>
          {players.loading && (
            <div className="px-5">
              <LoadingState label="Ranking" />
            </div>
          )}
          {players.error && (
            <div className="p-5">
              <ErrorNote message={players.error} />
            </div>
          )}
          <ol>
            {(players.data ?? []).map((player) => (
              <li key={player.entity_id}>
                <button
                  className="person-rank"
                  type="button"
                  aria-pressed={selectedId === String(player.entity_id)}
                  onClick={() =>
                    setSelected((current) =>
                      current?.id === String(player.entity_id) &&
                      current.caseId === caseId
                        ? null
                        : { caseId, id: String(player.entity_id) },
                    )
                  }
                >
                  <span className="flex items-baseline gap-3">
                    <span className="numeric text-xs text-muted">
                      {String(player.rank).padStart(2, '0')}
                    </span>
                    <span className="person-name min-w-0 flex-1 truncate">
                      {player.name}
                    </span>
                    <span className="numeric text-xs text-muted">
                      {player.score.toFixed(3)}
                    </span>
                  </span>
                  <span className="score-bar">
                    <span
                      style={{
                        width: `${Math.max(0, (player.score / Math.max(players.data?.[0]?.score ?? 1, 0.000001)) * 100)}%`,
                      }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="px-5 pb-5 pt-3 text-xs leading-relaxed text-muted">
            People who bridge parts of the recorded network. A high score is a
            reason to inspect the evidence.
          </p>
        </aside>
      </div>
      <div className="case-bottom">
        <section>
          <header className="section-title">
            <h2>Signals worth a look</h2>
            <Link className="button button-link" to="/alerts">
              All signals
              <ArrowUpRight size={14} />
            </Link>
          </header>
          {alerts.loading && <LoadingState label="Reading signals" />}
          {alerts.error && <ErrorNote message={alerts.error} />}
          {alerts.data?.length === 0 && (
            <div className="flex items-start gap-3 py-6">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-status-supported/10 text-status-supported">
                <Check size={15} />
              </span>
              <div>
                <p className="text-sm font-semibold text-heading">
                  No signals raised
                </p>
                <p className="mt-1 text-xs text-muted">
                  No detection threshold has been crossed in the current case
                  records.
                </p>
              </div>
            </div>
          )}
          <ol>
            {(alerts.data ?? []).slice(0, 3).map((alert) => (
              <li key={alert.id}>
                <Link className="case-link-row" to="/alerts">
                  <div>
                    <span
                      className={`mb-1 block text-xs font-semibold capitalize ${alert.severity === 'high' ? 'text-sev-high' : alert.severity === 'medium' ? 'text-sev-medium' : 'text-sev-low'}`}
                    >
                      {alert.severity} priority
                    </span>
                    <strong>{alert.title}</strong>
                  </div>
                  <ArrowUpRight size={17} />
                </Link>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <header className="section-title">
            <h2>Follow the evidence</h2>
          </header>
          <Link className="case-link-row" to="/documents">
            <div>
              <strong>Read the original sources</strong>
              <p>
                Inspect documents, extracted people, and the passages behind a
                link.
              </p>
            </div>
            <ArrowUpRight size={18} />
          </Link>
          <Link className="case-link-row" to="/findings">
            <div>
              <strong>Connect this to other cases</strong>
              <p>
                Review shared contacts, challenge identities, and check what
                holds up.
              </p>
            </div>
            <ArrowUpRight size={18} />
          </Link>
        </section>
      </div>
    </div>
  )
}
