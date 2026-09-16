import { useCallback, useMemo, useState } from 'react'

import { api } from '../api/client'
import type { EntityType, MetricName } from '../api/types'
import EvidencePanel from '../components/EvidencePanel'
import { ErrorNote, Legend, Panel, Segmented, Spinner } from '../components/Instrument'
import NetworkGraph from '../components/NetworkGraph'
import { useCase } from '../lib/CaseContext'
import { useAsync } from '../lib/useApi'

const METRICS: { value: MetricName; label: string }[] = [
  { value: 'betweenness', label: 'Between' },
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
  degree: 'Raw contact count. Surfaces the busy, not necessarily the important.',
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

  const [metric, setMetric] = useState<MetricName>('betweenness')
  const [colorBy, setColorBy] = useState<'type' | 'community'>('type')
  const [scope, setScope] = useState<Scope>('actors')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [flagKeyPlayers, setFlagKeyPlayers] = useState(false)
  const [pathEnds, setPathEnds] = useState<{ source: number | null; target: number | null }>({
    source: null,
    target: null,
  })
  const [pathIds, setPathIds] = useState<Set<string> | null>(null)
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  const entityTypes = useMemo(() => typesForScope(scope), [scope])
  const typeKey = entityTypes.join(',')

  const graph = useAsync(() => api.getGraph(caseId!, { entityTypes }), [caseId, typeKey, version], {
    enabled: caseId !== null,
  })
  const keyPlayers = useAsync(() => api.getKeyPlayers(caseId!, metric, 10), [caseId, metric, version], {
    enabled: caseId !== null,
  })
  const vulnerabilities = useAsync(() => api.getVulnerabilities(caseId!, 5), [caseId, version], {
    enabled: caseId !== null,
  })

  // An isolated node says nothing about a network, and the layout tiles every
  // one of them into the same strip where their labels print over each other.
  const drawn = useMemo(() => {
    if (!graph.data) return null
    const linked = new Set<string>()
    for (const edge of graph.data.edges) {
      linked.add(edge.source)
      linked.add(edge.target)
    }
    return { ...graph.data, nodes: graph.data.nodes.filter((n) => linked.has(n.id)) }
  }, [graph.data])

  // Live fragment count for the removal simulation, scored the way the backend
  // scores it: connected components over people only. Places and organisations
  // are attributes, and counting them would let them bridge the cells.
  const fragments = useMemo(() => {
    if (!drawn || removed.size === 0) return null
    const people = new Set(
      drawn.nodes.filter((n) => n.entity_type === 'PERSON' && !removed.has(n.id)).map((n) => n.id),
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
    setSelectedEdge(null)
    setSelectedNode(entityId === -1 ? null : String(entityId))
  }, [])

  const handleSelectEdge = useCallback((edgeId: string) => {
    setSelectedNode(null)
    setSelectedEdge(edgeId)
  }, [])

  async function findPath() {
    if (caseId === null || pathEnds.source === null || pathEnds.target === null) return
    const result = await api.findPath(caseId, pathEnds.source, pathEnds.target)
    setPathIds(result.found ? new Set(result.entity_ids.map(String)) : new Set())
    setFlagKeyPlayers(false)
  }

  function toggleRemoval(id: string) {
    setRemoved((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (caseId === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Legend>No case loaded — seed the demo from the Sources tab</Legend>
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
    <div className="grid min-h-full grid-cols-1 xl:h-full xl:min-h-0 xl:grid-cols-[248px_minmax(0,1fr)_312px]">
      <aside className="grid grid-cols-1 gap-px border-b hairline gap-fill sm:grid-cols-2 xl:flex xl:min-h-0 xl:grid-cols-none xl:flex-col xl:overflow-y-auto xl:border-b-0 xl:border-r">
        <div className="bg-ink-1000 p-4">
          <Legend>Size nodes by</Legend>
          <div className="mt-2">
            <Segmented options={METRICS} value={metric} onChange={setMetric} />
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-ink-500">{METRIC_BLURB[metric]}</p>
        </div>

        <div className="bg-ink-1000 p-4">
          <Legend>Colour</Legend>
          <div className="mt-2">
            <Segmented
              options={[
                { value: 'type' as const, label: 'Type' },
                { value: 'community' as const, label: 'Cell' },
              ]}
              value={colorBy}
              onChange={setColorBy}
            />
          </div>
        </div>

        <div className="bg-ink-1000 p-4">
          <Legend>Scope</Legend>
          <div className="mt-2">
            <Segmented options={SCOPES} value={scope} onChange={setScope} />
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-ink-500">
            Centrality always runs over actors. Places and identifiers are attributes,
            not participants.
          </p>
        </div>

        <div className="bg-ink-1000 p-4 sm:col-span-2 xl:flex-1">
          <div className="flex items-center justify-between">
            <Legend>Key players</Legend>
            <button
              type="button"
              onClick={() => {
                setFlagKeyPlayers((v) => !v)
                setPathIds(null)
              }}
              className={`font-cond text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                flagKeyPlayers ? 'text-signal' : 'text-ink-500 hover:text-ink-200'
              }`}
            >
              {flagKeyPlayers ? 'Clear' : 'Flag'}
            </button>
          </div>

          {keyPlayers.loading && (
            <div className="mt-3">
              <Spinner label="Ranking" />
            </div>
          )}

          <ol className="mt-3 space-y-0.5">
            {(keyPlayers.data ?? []).map((player) => (
              <li key={player.entity_id} className="rise">
                <button
                  type="button"
                  onClick={() => handleSelectNode(player.entity_id)}
                  className={`flex w-full items-baseline gap-2 px-1.5 py-1 text-left transition-colors hover:bg-ink-900 ${
                    selectedNode === String(player.entity_id) ? 'bg-ink-900' : ''
                  }`}
                >
                  <span className="readout w-4 shrink-0 text-[10px] text-ink-700">
                    {String(player.rank).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-200">
                    {player.name}
                  </span>
                  <span className="readout text-[10px] text-signal-dim">
                    {player.score.toFixed(3)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </aside>

      <section className="plot-surface relative h-[58vh] min-h-80 xl:h-auto xl:min-h-0">
        {graph.loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <Spinner label="Building network" />
          </div>
        )}
        {graph.error && (
          <div className="absolute inset-x-6 top-6 z-10">
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

        <div className="pointer-events-none absolute left-4 top-4 flex gap-6">
          <div>
            <Legend>Nodes</Legend>
            <p className="readout text-lg leading-none text-ink-100">{visibleNodes}</p>
          </div>
          <div>
            <Legend>Edges</Legend>
            <p className="readout text-lg leading-none text-ink-100">{visibleEdges}</p>
          </div>
          {removed.size > 0 && (
            <div className="rise">
              <Legend className="text-signal">Withheld</Legend>
              <p className="readout text-lg leading-none text-signal">{removed.size}</p>
            </div>
          )}
          {fragments !== null && (
            <div className="rise">
              <Legend className="text-signal">Fragments</Legend>
              <p className="readout text-lg leading-none text-signal">{fragments}</p>
            </div>
          )}
        </div>

        {pathIds && (
          <div className="rise absolute bottom-4 left-4 flex items-center gap-3 border hairline bg-ink-950/90 px-3 py-2">
            <Legend>{pathIds.size ? `Path — ${pathIds.size - 1} hops` : 'No path found'}</Legend>
            <button
              type="button"
              onClick={() => setPathIds(null)}
              className="font-cond text-[10px] font-semibold uppercase tracking-[0.1em] text-signal"
            >
              Clear
            </button>
          </div>
        )}
      </section>

      <aside className="flex flex-col border-t hairline xl:min-h-0 xl:border-l xl:border-t-0">
        <div className="min-h-64 flex-1 overflow-hidden border-b hairline xl:min-h-0">
          <EvidencePanel
            caseId={caseId}
            node={selected}
            edge={selectedEdgeData}
            nodesById={nodesById}
          />
        </div>

        <Panel title="Trace connection" className="border-x-0 border-t-0">
          <div className="space-y-2 p-3">
            <EndpointPicker
              label="From"
              value={pathEnds.source}
              nodes={graph.data?.nodes ?? []}
              onChange={(v) => setPathEnds((p) => ({ ...p, source: v }))}
            />
            <EndpointPicker
              label="To"
              value={pathEnds.target}
              nodes={graph.data?.nodes ?? []}
              onChange={(v) => setPathEnds((p) => ({ ...p, target: v }))}
            />
            <button
              type="button"
              onClick={findPath}
              disabled={pathEnds.source === null || pathEnds.target === null}
              className="w-full border hairline py-1.5 font-cond text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-200 transition-colors enabled:hover:border-signal enabled:hover:text-signal disabled:opacity-35"
            >
              Trace
            </button>
          </div>
        </Panel>

        <Panel title="Removal simulation" className="border-x-0 border-b-0">
          <div className="p-3">
            <p className="mb-2 text-[11px] leading-relaxed text-ink-500">
              Take a broker out and watch what the network does without them.
            </p>
            <ul className="space-y-1">
              {impact.map((item) => {
                const id = String(item.entity_id)
                const isRemoved = removed.has(id)
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => toggleRemoval(id)}
                      className={`flex w-full items-center gap-2 border px-2 py-1.5 text-left transition-colors ${
                        isRemoved ? 'border-signal/60 bg-signal/10' : 'hairline hover:border-ink-700'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-200">
                        {item.name}
                      </span>
                      <span className="readout text-[10px] text-ink-500">
                        {item.components_before}/{item.components_after}
                      </span>
                      <span className="readout text-[10px] text-signal-dim">
                        {(item.fragmentation_delta * 100).toFixed(0)}%
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {removed.size > 0 && (
              <button
                type="button"
                onClick={() => setRemoved(new Set())}
                className="mt-2 w-full py-1 font-cond text-[10px] font-semibold uppercase tracking-[0.1em] text-signal"
              >
                Restore all
              </button>
            )}
          </div>
        </Panel>
      </aside>
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
    <label className="flex items-center gap-2">
      <Legend className="w-7 shrink-0">{label}</Legend>
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        className="min-w-0 flex-1 border hairline bg-ink-950 px-2 py-1 text-xs text-ink-200"
      >
        <option value="">-</option>
        {people.map((node) => (
          <option key={node.id} value={node.id}>
            {node.label}
          </option>
        ))}
      </select>
    </label>
  )
}
