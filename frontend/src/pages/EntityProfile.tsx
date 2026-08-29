import { Link, useParams } from 'react-router-dom'

import { EmptyPanel, PageHeader } from '../components/Instrument'

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
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
      <PageHeader eyebrow={`Entity #${entityId}`} title="Dossier">
        Metrics, transactions, call activity, ego network, and source evidence for a
        single actor.
      </PageHeader>

      <div className="mt-6">
        <EmptyPanel
          title="Dossier not built yet"
          action={
            <Link
              to="/graph"
              className="inline-block border hairline px-3 py-1.5 font-cond text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-200 transition-colors hover:border-signal hover:text-signal"
            >
              Open the network
            </Link>
          }
        >
          Select this entity in the network to read its links, its evidence, and the
          documents that name it.
        </EmptyPanel>
      </div>
    </div>
  )
}
