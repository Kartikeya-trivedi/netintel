import type { Status } from '../../api/investigation'

/** A finding's analytical status, distinguished by both icon and words. */

interface StatusMeta {
  label: string
  short: string
  explain: string
  className: string
}

export const STATUS_META: Record<Status, StatusMeta> = {
  supported: {
    label: 'Supported',
    short: 'Supported',
    explain:
      'At least one route rests on no unreviewed identity and passes no high-activity contact.',
    className: 'text-status-supported',
  },
  lead: {
    label: 'Lead (needs review)',
    short: 'Lead',
    explain:
      'Every route found rests on an unreviewed identity or passes a high-activity contact. Review before relying on it.',
    className: 'text-status-lead',
  },
  unsupported: {
    label: 'Not supported',
    short: 'Not supported',
    explain: 'No route between the two within the search scope.',
    className: 'text-status-unsupported',
  },
}

export function statusLabel(status: Status, short = false): string {
  const meta = STATUS_META[status] ?? STATUS_META.unsupported
  return short ? meta.short : meta.label
}

export default function StatusBadge({
  status,
  short = false,
  size = 'sm',
}: {
  status: Status
  short?: boolean
  size?: 'sm' | 'md'
}) {
  const meta = STATUS_META[status] ?? STATUS_META.unsupported
  return (
    <span
      title={meta.explain}
      className={`status-badge status-${status} ${size === 'md' ? 'px-2.5 py-1.5' : ''} ${meta.className}`}
    >
      <span className="state-mark" data-state={status} aria-hidden="true" />
      {short ? meta.short : meta.label}
    </span>
  )
}

/** "Lead → Not supported", with both ends labelled. */
export function StatusChange({ from, to }: { from: Status; to: Status }) {
  if (from === to) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <StatusBadge status={to} short />
        <span className="text-xs font-semibold text-muted">unchanged</span>
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge status={from} short />
      <span aria-hidden="true" className="text-muted">
        →
      </span>
      <span className="sr-only">becomes</span>
      <StatusBadge status={to} short />
    </span>
  )
}
