import type { Alert, Severity } from '../api/types'

import { Legend } from './Instrument'

/** Severity is one of only three saturated things on screen, so it carries the
 *  card: a coloured rail on the leading edge plus a matching chip. */
const SEVERITY_RAIL: Record<Severity, string> = {
  low: 'bg-sev-low',
  medium: 'bg-sev-medium',
  high: 'bg-sev-high',
}

const SEVERITY_CHIP: Record<Severity, string> = {
  low: 'border-sev-low/40 bg-sev-low/10 text-sev-low',
  medium: 'border-sev-medium/40 bg-sev-medium/10 text-sev-medium',
  high: 'border-sev-high/40 bg-sev-high/10 text-sev-high',
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
    <article className="bezel relative border hairline bg-ink-950/70 pl-4 transition-colors hover:border-ink-700">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${SEVERITY_RAIL[alert.severity]}`} />

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Legend>{TYPE_LABELS[alert.alert_type] ?? alert.alert_type}</Legend>
            <h3 className="mt-1.5 text-sm font-medium leading-snug text-ink-100">{alert.title}</h3>
          </div>
          <span
            className={`shrink-0 border px-2 py-0.5 font-cond text-[10px] font-semibold uppercase tracking-[0.1em] ${
              SEVERITY_CHIP[alert.severity]
            }`}
          >
            {alert.severity}
          </span>
        </div>

        {alert.description && (
          <p className="mt-2.5 text-[13px] leading-relaxed text-ink-500">{alert.description}</p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 border-t hairline pt-3">
          <span className="readout text-[10px] text-ink-700">
            {alert.entity_ids.length} entit{alert.entity_ids.length === 1 ? 'y' : 'ies'}
            {alert.status === 'reviewed' && ' · reviewed'}
          </span>
          <button
            type="button"
            onClick={() => onInspect?.(alert)}
            className="font-cond text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400 transition-colors hover:text-signal"
          >
            Inspect in graph →
          </button>
        </div>
      </div>
    </article>
  )
}
