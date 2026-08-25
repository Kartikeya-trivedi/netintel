/** Filterable anomaly feed. Each alert deep-links into the graph and shows the
 *  evidence series behind the flag.
 *
 *  TODO(Phase 5): load api.listAlerts, render <AlertCard> and <TimelineChart>.
 */
export default function Alerts() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-console-200">Alerts</h1>
      <p className="mt-1 text-sm text-console-400">
        Transaction spikes, structuring patterns, and communication bursts.
      </p>
      <div className="mt-6 rounded-lg border border-dashed border-console-800 p-8 text-center text-sm text-console-400">
        Alert feed — Phase 5
      </div>
    </div>
  )
}
