import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { GraphEdge, GraphNode } from '../api/types'
import { useAsync } from '../lib/useApi'
import EntityBadge from './EntityBadge'
import { Empty, Legend, Spinner } from './Instrument'

const METRIC_LABELS: Record<string, string> = {
  betweenness: 'Betweenness',
  degree: 'Degree',
  pagerank: 'PageRank',
  eigenvector: 'Eigenvector',
}

/** Everything the graph asserts, traced back to its source.
 *
 *  The panel is the answer to "why is this on my screen?", so it leads with
 *  evidence rather than scores. A number an investigator cannot audit is worse
 *  than no number.
 */
export default function EvidencePanel({
  caseId,
  node,
  edge,
  nodesById,
}: {
  caseId: number
  node: GraphNode | null
  edge: GraphEdge | null
  nodesById: Map<string, GraphNode>
}) {
  if (edge) return <EdgeEvidence edge={edge} nodesById={nodesById} />
  if (node) return <NodeDossier caseId={caseId} node={node} />
  return (
    <Empty>
      Select a node to open its dossier, or an edge to read the evidence behind
      the link.
    </Empty>
  )
}

function EdgeEvidence({
  edge,
  nodesById,
}: {
  edge: GraphEdge
  nodesById: Map<string, GraphNode>
}) {
  const source = nodesById.get(edge.source)
  const target = nodesById.get(edge.target)

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b hairline p-4">
        <Legend>Link</Legend>
        <p className="mt-2 text-sm text-ink-100">
          {source?.label ?? edge.source}
          <span className="mx-2 text-signal">→</span>
          {target?.label ?? edge.target}
        </p>
        <div className="mt-3 flex items-center gap-4">
          <span className="font-mono text-[11px] text-ink-400">
            {edge.rel_type.replace(/_/g, ' ').toLowerCase()}
          </span>
          <span className="readout text-[11px] text-ink-500">
            weight {edge.weight.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="p-4">
        <Legend>Evidence · {edge.evidence.length}</Legend>
        <ul className="mt-3 space-y-3">
          {edge.evidence.map((item, index) => (
            <li
              key={index}
              className="border-l-2 border-signal-dim/60 bg-ink-900/60 py-2 pl-3 pr-2"
            >
              <p className="text-xs leading-relaxed text-ink-200">
                {String(item.snippet ?? item.summary ?? JSON.stringify(item))}
              </p>
              {item.doc_id !== undefined && (
                <Legend className="mt-1.5 block">Document {String(item.doc_id)}</Legend>
              )}
            </li>
          ))}
          {edge.evidence.length === 0 && (
            <li className="text-xs text-ink-500">No evidence recorded.</li>
          )}
        </ul>
      </div>
    </div>
  )
}

function NodeDossier({ caseId, node }: { caseId: number; node: GraphNode }) {
  const entityId = Number(node.id)
  const { data, loading } = useAsync(() => api.getEntity(caseId, entityId), [caseId, entityId])

  const ranked = Object.entries(node.metrics)
    .filter(([name]) => name in METRIC_LABELS)
    .sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b hairline p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold leading-tight text-ink-100">{node.label}</h2>
          <EntityBadge type={node.entity_type} />
        </div>

        {data?.aliases?.length ? (
          <p className="mt-2 text-xs text-ink-400">
            <span className="text-ink-500">Also known as </span>
            {data.aliases.join(', ')}
          </p>
        ) : null}

        {node.community_id !== null && (
          <Legend className="mt-3 block">Community {node.community_id}</Legend>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px border-b hairline gap-fill">
        {ranked.map(([name, score]) => (
          <div key={name} className="bg-ink-950 px-4 py-3">
            <Legend>{METRIC_LABELS[name]}</Legend>
            <p className="readout mt-1 text-sm text-ink-100">{score.toFixed(4)}</p>
          </div>
        ))}
      </div>

      <div className="p-4">
        {loading && <Spinner label="Loading dossier" />}
        {data && (
          <>
            <Legend>Mentions</Legend>
            <p className="readout mt-1 text-sm text-ink-100">{data.mention_count}</p>
            <Link
              to={`/entities/${entityId}`}
              className="mt-4 inline-block border hairline px-3 py-1.5 font-cond text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-200 transition-colors hover:border-signal hover:text-signal"
            >
              Open full dossier
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
