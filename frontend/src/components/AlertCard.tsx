import type { Alert, Severity } from '../api/types'

const SEVERITY_STYLES: Record<Severity, string> = {
  low: 'border-severity-low/40 bg-severity-low/10 text-severity-low',
  medium: 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium',
  high: 'border-severity-high/40 bg-severity-high/10 text-severity-high',
}

const TYPE_LABELS: Record<string, string> = {
  TRANSACTION_SPIKE: 'Transaction spike',
  STRUCTURING: 'Structuring',
  COMM_BURST: 'Communication burst',
  NEW_LINK: 'New link',
  HIGH_CENTRALITY_SHIFT: 'Centrality shift',
}

export default function AlertCard({
  alert,
  onInspect,
}: {
  alert: Alert
  onInspect?: (alert: Alert) => void
}) {
  return (
    <article className="rounded-lg border border-console-800 bg-console-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-console-200">{alert.title}</h3>
          <p className="mt-0.5 text-xs text-console-400">
            {TYPE_LABELS[alert.alert_type] ?? alert.alert_type}
          </p>
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-0.5 text-xs font-medium capitalize ${
            SEVERITY_STYLES[alert.severity]
          }`}
        >
          {alert.severity}
        </span>
      </div>

      {alert.description && (
        <p className="mt-2 text-sm leading-relaxed text-console-400">{alert.description}</p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => onInspect?.(alert)}
          className="rounded-md bg-console-800 px-2.5 py-1 text-xs text-console-200 hover:bg-console-700"
        >
          Inspect in graph
        </button>
        <span className="text-xs text-console-400">
          {alert.entity_ids.length} entit{alert.entity_ids.length === 1 ? 'y' : 'ies'} involved
        </span>
      </div>
    </article>
  )
}
