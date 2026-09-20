import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { GraphEdge, GraphNode } from '../api/types'
import { useAsync } from '../lib/useApi'
import EntityBadge from './EntityBadge'
import { EmptyNote, FieldLabel, LoadingState } from '../ui'

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
    <EmptyNote>
      Select a node to open its dossier, or an edge to read the evidence behind
      the link.
    </EmptyNote>
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
      <div className="border-b border-border p-4">
        <FieldLabel>Link</FieldLabel>
        <p className="mt-2 text-sm text-heading">
          {source?.label ?? edge.source}
          <span className="mx-2 text-primary">→</span>
          {target?.label ?? edge.target}
        </p>
        <div className="mt-3 flex items-center gap-4">
          <span className="font-mono text-xs text-body">
            {edge.rel_type.replace(/_/g, ' ').toLowerCase()}
          </span>
          <span className="numeric text-xs text-muted">
            weight {edge.weight.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="p-4">
        <FieldLabel>Evidence · {edge.evidence.length}</FieldLabel>
        <ul className="mt-3 space-y-3">
          {edge.evidence.map((item, index) => (
            <li
              key={index}
              className="border-l-2 border-primary-hover/60 bg-subtle/60 py-2 pl-3 pr-2"
            >
              <p className="text-xs leading-relaxed text-body">
                {String(item.snippet ?? item.summary ?? JSON.stringify(item))}
              </p>
              {item.doc_id !== undefined && (
                <FieldLabel className="mt-1.5 block">
                  Document {String(item.doc_id)}
                </FieldLabel>
              )}
            </li>
          ))}
          {edge.evidence.length === 0 && (
            <li className="text-xs text-muted">No evidence recorded.</li>
          )}
        </ul>
      </div>
    </div>
  )
}

function NodeDossier({ caseId, node }: { caseId: number; node: GraphNode }) {
  const entityId = Number(node.id)
  const { data, loading } = useAsync(
    () => api.getEntity(caseId, entityId),
    [caseId, entityId],
  )

  const ranked = Object.entries(node.metrics)
    .filter(([name]) => name in METRIC_LABELS)
    .sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold leading-tight text-heading">
            {node.label}
          </h2>
          <EntityBadge type={node.entity_type} />
        </div>

        {data?.aliases?.length ? (
          <p className="mt-2 text-xs text-body">
            <span className="text-muted">Also known as </span>
            {data.aliases.join(', ')}
          </p>
        ) : null}

        {node.community_id !== null && (
          <FieldLabel className="mt-3 block">
            Community {node.community_id}
          </FieldLabel>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-border bg-border">
        {ranked.map(([name, score]) => (
          <div key={name} className="bg-surface px-4 py-3">
            <FieldLabel>{METRIC_LABELS[name]}</FieldLabel>
            <p className="numeric mt-1 text-sm text-heading">
              {score.toFixed(4)}
            </p>
          </div>
        ))}
      </div>

      <div className="p-4">
        {loading && <LoadingState label="Loading dossier" />}
        {data && (
          <>
            <FieldLabel>Mentions</FieldLabel>
            <p className="numeric mt-1 text-sm text-heading">
              {data.mention_count}
            </p>
            <Link
              to={`/entities/${entityId}`}
              className="mt-4 inline-block border border-border px-3 py-1.5 text-xs font-semibold text-body transition-colors hover:border-primary hover:text-primary"
            >
              Open full dossier
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
