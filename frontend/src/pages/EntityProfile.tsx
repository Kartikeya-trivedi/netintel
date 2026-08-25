import { useParams } from 'react-router-dom'

/** Full dossier for one entity: metrics, transactions, call activity, ego
 *  network, and every piece of source evidence.
 *
 *  TODO(Phase 6): load api.getEntity and render the dossier.
 */
export default function EntityProfile() {
  const { entityId } = useParams()

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-console-200">Entity dossier</h1>
      <p className="mt-1 text-sm text-console-400">Entity #{entityId} — Phase 6</p>
    </div>
  )
}
