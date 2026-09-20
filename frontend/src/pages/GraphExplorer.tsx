import { useCallback, useEffect, useMemo, useState } from 'react'

import { ArrowRight } from '../ui/Symbols'
import { api } from '../api/client'
import type { EntityType, MetricName } from '../api/types'
import EvidencePanel from '../components/EvidencePanel'
import {
  Button,
  Callout,
  EmptyState,
  ErrorNote,
  FieldLabel,
  Segmented,
  LoadingState,
} from '../ui'
import NetworkGraph from '../components/NetworkGraph'
import { useCase } from '../lib/CaseContext'
import { useAsync } from '../lib/useApi'

const METRICS: { value: MetricName; label: string }[] = [
  { value: 'betweenness', label: 'Betweenness' },
  { value: 'degree', label: 'Degree' },
  { value: 'pagerank', label: 'PageRank' },
]

const ACTOR_TYPES: EntityType[] = ['PERSON', 'ORG']
const CONTEXT_TYPES: EntityType[] = ['LOCATION', 'VEHICLE', 'DRUG', 'WEAPON']
const IDENTIFIER_TYPES: EntityType[] = ['PHONE', 'BANK_ACCOUNT']

type Scope = 'actors' | 'context' | 'all'

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'actors', label: 'Actors' },
  { value: 'context', label: '+Context' },
  { value: 'all', label: 'All' },
]

const METRIC_BLURB: Record<MetricName, string> = {
  betweenness:
    'Brokerage. Ranks whoever sits on the paths between groups, even with few direct contacts.',
  degree:
    'Raw contact count. Surfaces the busy, not necessarily the important.',
  pagerank: 'Influence weighted by the influence of the people around you.',
  eigenvector: 'Influence weighted by the influence of the people around you.',
}

function typesForScope(scope: Scope): EntityType[] {
  if (scope === 'actors') return ACTOR_TYPES
  if (scope === 'context') return [...ACTOR_TYPES, ...CONTEXT_TYPES]
  return [...ACTOR_TYPES, ...CONTEXT_TYPES, ...IDENTIFIER_TYPES]
}

export default function GraphExplorer() {
  const { activeCase, version } = useCase()
  const caseId = activeCase?.id ?? null

  const [inspector, setInspector] = useState<'evidence' | 'trace' | 'simulate'>(
    'evidence',
  )
  const [pathBusy, setPathBusy] = useState(false)
  const [pathError, setPathError] = useState<string | null>(null)
  const [metric, setMetric] = useState<MetricName>('betweenness')
  const [colorBy, setColorBy] = useState<'type' | 'community'>('type')
  const [scope, setScope] = useState<Scope>('actors')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [flagKeyPlayers, setFlagKeyPlayers] = useState(false)
  const [pathEnds, setPathEnds] = useState<{
    source: number | null
    target: number | null
  }>({
    source: null,
    target: null,
  })
  const [pathIds, setPathIds] = useState<Set<string> | null>(null)
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  const entityTypes = useMemo(() => typesForScope(scope), [scope])
  const typeKey = entityTypes.join(',')

  const graph = useAsync(
    () => api.getGraph(caseId!, { entityTypes }),
    [caseId, typeKey, version],
    {
      enabled: caseId !== null,
    },
  )
  const keyPlayers = useAsync(
    () => api.getKeyPlayers(caseId!, metric, 10),
    [caseId, metric, version],
    {
      enabled: caseId !== null,
    },
  )
  const vulnerabilities = useAsync(
    () => api.getVulnerabilities(caseId!, 5),
    [caseId, version],
    {
      enabled: caseId !== null,
    },
  )

  // An isolated node says nothing about a network, and the layout tiles every
  // one of them into the same strip where their labels print over each other.
  const drawn = useMemo(() => {
    if (!graph.data) return null
    const linked = new Set<string>()
    for (const edge of graph.data.edges) {
      linked.add(edge.source)
      linked.add(edge.target)
    }
    return {
      ...graph.data,
      nodes: graph.data.nodes.filter((n) => linked.has(n.id)),
    }
  }, [graph.data])

  // Live fragment count for the removal simulation, scored the way the backend
  // scores it: connected components over people only. Places and organisations
  // are attributes, and counting them would let them bridge the cells.
  const fragments = useMemo(() => {
    if (!drawn || removed.size === 0) return null
    const people = new Set(
      drawn.nodes
        .filter((n) => n.entity_type === 'PERSON' && !removed.has(n.id))
        .map((n) => n.id),
    )
    const parent = new Map<string, string>()
    for (const id of people) parent.set(id, id)
    const find = (id: string): string => {
      let root = id
      while (parent.get(root) !== root) root = parent.get(root)!
      parent.set(id, root)
      return root
    }
    for (const edge of drawn.edges) {
      if (people.has(edge.source) && people.has(edge.target)) {
        parent.set(find(edge.source), find(edge.target))
      }
    }
    return new Set([...people].map(find)).size
  }, [drawn, removed])

  const nodesById = useMemo(
    () => new Map((graph.data?.nodes ?? []).map((n) => [n.id, n])),
    [graph.data],
  )

  const highlighted = useMemo(() => {
    if (pathIds) return pathIds
    if (flagKeyPlayers && keyPlayers.data) {
      return new Set(keyPlayers.data.map((k) => String(k.entity_id)))
    }
    return undefined
  }, [pathIds, flagKeyPlayers, keyPlayers.data])

  const handleSelectNode = useCallback((entityId: number) => {
    setInspector('evidence')
    setSelectedEdge(null)
    setSelectedNode(entityId === -1 ? null : String(entityId))
  }, [])

  const handleSelectEdge = useCallback((edgeId: string) => {
    setInspector('evidence')
    setSelectedNode(null)
    setSelectedEdge(edgeId)
  }, [])

  async function findPath() {
    if (caseId === null || pathEnds.source === null || pathEnds.target === null)
      return
    setPathBusy(true)
    setPathError(null)
    try {
      const result = await api.findPath(
        caseId,
        pathEnds.source,
        pathEnds.target,
      )
      setPathIds(
        result.found ? new Set(result.entity_ids.map(String)) : new Set(),
      )
      setFlagKeyPlayers(false)
    } catch (error) {
      setPathError(error instanceof Error ? error.message : String(error))
    } finally {
      setPathBusy(false)
    }
  }

  function toggleRemoval(id: string) {
    setRemoved((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    setSelectedNode(null)
    setSelectedEdge(null)
    setRemoved(new Set())
    setPathIds(null)
    setPathEnds({ source: null, target: null })
    setPathError(null)
  }, [caseId])

  if (caseId === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <FieldLabel>
          No case loaded — seed the demo from the Sources tab
        </FieldLabel>
      </div>
    )
  }

  const selected = selectedNode ? (nodesById.get(selectedNode) ?? null) : null
  const selectedEdgeData = selectedEdge
    ? (graph.data?.edges.find((e) => e.id === selectedEdge) ?? null)
    : null
  const impact = vulnerabilities.data?.removal_impacts ?? []
  const visibleNodes = (drawn?.nodes.length ?? 0) - removed.size
  const visibleEdges = (drawn?.edges ?? []).filter(
    (e) => !removed.has(e.source) && !removed.has(e.target),
  ).length

  return (
    <div className="graph-workspace">
      <header className="graph-toolbar">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-bold text-heading">Network explorer</h1>
            <p className="text-xs text-muted">
              Follow the people. Inspect the evidence.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-muted">
            Size by
            <select
              aria-label="Size nodes by"
              value={metric}
              onChange={(event) => setMetric(event.target.value as MetricName)}
            >
              {METRICS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-2">
            <FieldLabel>Colour</FieldLabel>
            <Segmented
              options={[
                { value: 'type' as const, label: 'Type' },
                { value: 'community' as const, label: 'Cell' },
              ]}
              value={colorBy}
              onChange={setColorBy}
            />
          </div>
          <div className="flex flex-col gap-2">
            <FieldLabel>Scope</FieldLabel>
            <Segmented options={SCOPES} value={scope} onChange={setScope} />
          </div>
        </div>
      </header>
      <div className="graph-grid">
        <aside className="graph-rank" aria-label="Key players">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-heading">Key players</h2>
            <Button
              variant="link"
              onClick={() => {
                setFlagKeyPlayers((value) => !value)
                setPathIds(null)
              }}
            >
              {flagKeyPlayers ? 'Clear' : 'Highlight'}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {METRIC_BLURB[metric]}
          </p>
          {keyPlayers.loading && <LoadingState label="Ranking" />}
          {keyPlayers.error && <ErrorNote message={keyPlayers.error} />}
          <ol className="mt-4 space-y-1">
            {(keyPlayers.data ?? []).map((player) => (
              <li key={player.entity_id}>
                <button
                  type="button"
                  onClick={() => handleSelectNode(player.entity_id)}
                  aria-pressed={selectedNode === String(player.entity_id)}
                  className="rank-row"
                >
                  <span className="flex items-center gap-2">
                    <span className="numeric w-4 shrink-0 text-xs text-muted">
                      {player.rank}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-heading">
                      {player.name}
                    </span>
                    <span className="numeric text-xs text-primary">
                      {player.score.toFixed(3)}
                    </span>
                  </span>
                  <span className="ml-6 mt-2 block h-1 overflow-hidden rounded-full bg-subtle">
                    <span
                      className="block h-full rounded-full bg-primary/70"
                      style={{
                        width: `${Math.max(2, (player.score / Math.max(keyPlayers.data?.[0]?.score ?? 1, 0.000001)) * 100)}%`,
                      }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-6 border-t border-border pt-4">
            <p className="flex items-center gap-2 text-xs font-semibold text-muted">
              Reading the graph
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Centrality runs over actors. Places and identifiers provide
              context. Hover or select a node to reveal its name. Select a
              connection for its evidence.
            </p>
          </div>
        </aside>
        <section
          className="graph-canvas graph-surface relative min-w-0"
          aria-label="Network graph"
        >
          {graph.loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/80">
              <LoadingState label="Building network" />
            </div>
          )}
          {graph.error && (
            <div className="absolute inset-x-5 top-20 z-10">
              <ErrorNote message={graph.error} />
            </div>
          )}
          {drawn && (
            <NetworkGraph
              data={drawn}
              sizeBy={metric}
              colorBy={colorBy}
              highlighted={highlighted}
              removed={removed}
              selectedId={selectedNode}
              onSelectNode={handleSelectNode}
              onSelectEdge={handleSelectEdge}
            />
          )}
          {drawn && drawn.nodes.length === 0 && (
            <div className="absolute inset-x-5 top-24">
              <EmptyState title="No connected entities">
                Try including context or identifiers, or add source records to
                this case.
              </EmptyState>
            </div>
          )}
          <div
            data-graph-overlay
            className="pointer-events-none absolute left-5 top-5 flex flex-wrap gap-3 rounded-lg border border-border bg-surface/95 px-4 py-2.5 text-xs shadow-sm"
          >
            <span className="inline-flex items-center gap-2">
              <b className="numeric text-heading">{visibleNodes}</b> nodes
            </span>
            <span className="border-l border-border pl-3">
              <b className="numeric text-heading">{visibleEdges}</b> connections
            </span>
            {removed.size > 0 && (
              <span className="text-primary">{removed.size} withheld</span>
            )}
            {fragments !== null && (
              <span className="text-primary">{fragments} fragments</span>
            )}
          </div>
          <div
            data-graph-overlay
            className="absolute bottom-5 left-5 max-w-[calc(100%-90px)]"
          >
            <div className="mb-2 flex flex-wrap gap-3 text-xs text-muted">
              {colorBy === 'type' ? (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-ent-person" />
                    Person
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-ent-org" />
                    Organisation
                  </span>
                  {scope !== 'actors' && <span>Additional context</span>}
                </>
              ) : (
                <span>Colour groups actors into network communities</span>
              )}
            </div>
            {pathIds && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 shadow-sm">
                <span className="text-xs text-heading">
                  {pathIds.size
                    ? `Connection found · ${pathIds.size - 1} hops`
                    : 'No path found'}
                </span>
                <Button variant="link" onClick={() => setPathIds(null)}>
                  Clear
                </Button>
              </div>
            )}
          </div>
        </section>
        <aside className="graph-inspector" aria-label="Network inspector">
          <div className="sticky top-0 z-10 border-b border-border bg-surface p-3">
            <Segmented
              options={[
                { value: 'evidence' as const, label: 'Evidence' },
                { value: 'trace' as const, label: 'Trace' },
                { value: 'simulate' as const, label: 'Simulate' },
              ]}
              value={inspector}
              onChange={setInspector}
            />
          </div>
          {inspector === 'evidence' && (
            <>
              <details className="border-b border-border px-4 py-3">
                <summary className="text-xs font-semibold text-body">
                  Choose from a list
                </summary>
                <div className="mt-3 space-y-3">
                  <label className="block text-xs text-muted">
                    Entity
                    <select
                      className="mt-1 block w-full"
                      aria-label="Inspect entity"
                      value={selectedNode ?? ''}
                      onChange={(event) =>
                        handleSelectNode(
                          event.target.value ? Number(event.target.value) : -1,
                        )
                      }
                    >
                      <option value="">Select an entity</option>
                      {(drawn?.nodes ?? []).map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-muted">
                    Connection
                    <select
                      className="mt-1 block w-full"
                      aria-label="Inspect connection"
                      value={selectedEdge ?? ''}
                      onChange={(event) => handleSelectEdge(event.target.value)}
                    >
                      <option value="">Select a connection</option>
                      {(drawn?.edges ?? []).map((edge) => (
                        <option key={edge.id} value={edge.id}>
                          {nodesById.get(edge.source)?.label} —{' '}
                          {nodesById.get(edge.target)?.label} (
                          {edge.rel_type.replace(/_/g, ' ').toLowerCase()})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </details>
              {!selected && !selectedEdgeData ? (
                <div className="inspector-start">
                  <h2>Follow a connection</h2>
                  <p>Select a person or a link to read its source evidence.</p>
                  {Boolean(keyPlayers.data?.length) && (
                    <>
                      <p className="inspector-caption">
                        Start with the highest-ranked people
                      </p>
                      {keyPlayers.data!.slice(0, 3).map((player) => (
                        <button
                          type="button"
                          key={player.entity_id}
                          onClick={() => handleSelectNode(player.entity_id)}
                        >
                          <span>{player.name}</span>
                          <span>{player.score.toFixed(3)} →</span>
                        </button>
                      ))}
                      <p>
                        Ranked by {metric}. A high score is a prompt to inspect
                        the evidence.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <EvidencePanel
                  caseId={caseId}
                  node={selected}
                  edge={selectedEdgeData}
                  nodesById={nodesById}
                />
              )}
            </>
          )}
          {inspector === 'trace' && (
            <div className="space-y-4 p-5">
              <div>
                <h2 className="text-base font-bold text-heading">
                  Trace a connection
                </h2>
                <p className="mt-2 text-xs text-muted">
                  Find the shortest path between two people in this case.
                </p>
              </div>
              <EndpointPicker
                label="From"
                value={pathEnds.source}
                nodes={graph.data?.nodes ?? []}
                onChange={(value) =>
                  setPathEnds((current) => ({ ...current, source: value }))
                }
              />
              <EndpointPicker
                label="To"
                value={pathEnds.target}
                nodes={graph.data?.nodes ?? []}
                onChange={(value) =>
                  setPathEnds((current) => ({ ...current, target: value }))
                }
              />
              <Button
                className="w-full"
                variant="primary"
                onClick={() => void findPath()}
                disabled={
                  pathBusy ||
                  pathEnds.source === null ||
                  pathEnds.target === null
                }
              >
                {pathBusy ? 'Tracing…' : 'Trace connection'}
                <ArrowRight size={15} />
              </Button>
              {pathError && <ErrorNote message={pathError} />}
            </div>
          )}
          {inspector === 'simulate' && (
            <div className="space-y-4 p-5">
              <div>
                <h2 className="text-base font-bold text-heading">
                  Removal simulation
                </h2>
                <p className="mt-2 text-xs text-muted">
                  Withhold a broker to see how the recorded network separates.
                </p>
              </div>
              {vulnerabilities.error && (
                <ErrorNote message={vulnerabilities.error} />
              )}
              <ul className="space-y-2">
                {impact.map((item) => {
                  const id = String(item.entity_id)
                  const isRemoved = removed.has(id)
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        aria-pressed={isRemoved}
                        onClick={() => toggleRemoval(id)}
                        className={`w-full rounded-lg border p-3 text-left ${isRemoved ? 'border-primary bg-primary-soft' : 'border-border hover:bg-subtle'}`}
                      >
                        <span className="block text-sm font-semibold text-heading">
                          {item.name}
                        </span>
                        <span className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                          <span>
                            {item.components_before} → {item.components_after}{' '}
                            fragments
                          </span>
                          <span className="numeric text-primary">
                            {(item.fragmentation_delta * 100).toFixed(0)}%
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {removed.size > 0 && (
                <Button
                  className="w-full"
                  onClick={() => setRemoved(new Set())}
                >
                  Restore all
                </Button>
              )}
              <Callout>
                This changes the displayed graph only. It does not predict the
                outcome of an intervention.
              </Callout>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function EndpointPicker({
  label,
  value,
  nodes,
  onChange,
}: {
  label: string
  value: number | null
  nodes: { id: string; label: string; entity_type: string }[]
  onChange: (value: number | null) => void
}) {
  const people = nodes
    .filter((n) => n.entity_type === 'PERSON')
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <label className="flex flex-col gap-2">
      <FieldLabel className="w-7 shrink-0">{label}</FieldLabel>
      <select
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value ? Number(event.target.value) : null)
        }
        className="min-w-0 flex-1 border border-border bg-surface px-2 py-1 text-xs text-body"
      >
        <option value="">Select a person</option>
        {people.map((node) => (
          <option key={node.id} value={node.id}>
            {node.label}
          </option>
        ))}
      </select>
    </label>
  )
}
