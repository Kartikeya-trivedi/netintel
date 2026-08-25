/** The centrepiece: interactive network with metric-driven sizing, community
 *  colouring, evidence panel, path finding, and removal simulation.
 *
 *  TODO(Phase 4): load api.getGraph, render <NetworkGraph>, and add the toolbar
 *  and side panel described in PLAN.md section 6.
 */
export default function GraphExplorer() {
  return (
    <div className="flex h-full">
      <div className="flex-1 p-6">
        <h1 className="text-xl font-semibold text-console-200">Graph Explorer</h1>
        <p className="mt-1 text-sm text-console-400">
          Size nodes by centrality, colour by community, and trace how any two
          entities connect.
        </p>
        <div className="mt-6 flex h-96 items-center justify-center rounded-lg border border-dashed border-console-800 text-sm text-console-400">
          Network canvas — Phase 4
        </div>
      </div>
    </div>
  )
}
