import { Link, useParams } from 'react-router-dom'

import { EmptyState, PageHeader } from '../ui'

/** Full dossier for one entity: metrics, transactions, call activity, ego
 *  network, and every piece of source evidence.
 *
 *  TODO(Phase 6): load api.getEntity and render the dossier. Until then this
 *  reads as a deliberate rest state rather than a page that failed to load —
 *  the evidence panel in the graph carries the same information for now.
 */
export default function EntityProfile() {
  const { entityId } = useParams()

  return (
    <div className="page-wrap max-w-5xl!">
      <PageHeader eyebrow={`Entity #${entityId}`} title="Dossier">
        Metrics, transactions, call activity, ego network, and source evidence
        for a single actor.
      </PageHeader>

      <div className="mt-6">
        <EmptyState
          title="Dossier not built yet"
          action={
            <Link to="/graph" className="button button-primary">
              Open the network
            </Link>
          }
        >
          Select this entity in the network to read its links, its evidence, and
          the documents that name it.
        </EmptyState>
      </div>
    </div>
  )
}
