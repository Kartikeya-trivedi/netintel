/** Case overview: headline counts, recent alerts, and entry into the graph.
 *
 *  TODO(Phase 5): wire to api.caseStats / api.listAlerts and add the mini
 *  network preview described in PLAN.md section 6.
 */
export default function Dashboard() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-console-200">Dashboard</h1>
      <p className="mt-1 text-sm text-console-400">
        Case overview, ingest status, and the live alert feed.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {['Entities', 'Relationships', 'Documents', 'Open alerts'].map((label) => (
          <div key={label} className="rounded-lg border border-console-800 bg-console-900 p-4">
            <p className="text-xs uppercase tracking-wide text-console-400">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-console-200">—</p>
          </div>
        ))}
      </div>

      <p className="mt-8 text-sm text-console-400">Phase 5 wires this to live data.</p>
    </div>
  )
}
