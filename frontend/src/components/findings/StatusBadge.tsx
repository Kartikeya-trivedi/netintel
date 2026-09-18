import type { Status } from '../../api/investigation'

/** A finding's analytical status, always in words.
 *
 *  The square beside the words is filled, half-filled or hollow so the three
 *  states differ in shape as well as colour; neither is ever the only carrier.
 */

interface StatusMeta {
  label: string
  short: string
  explain: string
  className: string
  glyph: string
}

export const STATUS_META: Record<Status, StatusMeta> = {
  supported: {
    label: 'Supported',
    short: 'Supported',
    explain:
      'At least one route rests on no unreviewed identity and passes no high-activity contact.',
    className: 'border-status-supported/45 bg-status-supported/10 text-status-supported',
    glyph: 'bg-current',
  },
  lead: {
    label: 'Lead — needs review',
    short: 'Lead',
    explain:
      'Every route found rests on an unreviewed identity or passes a high-activity contact. Review before relying on it.',
    className: 'border-status-lead/50 bg-status-lead/10 text-status-lead',
    glyph: 'border border-current bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]',
  },
  unsupported: {
    label: 'Not supported',
    short: 'Not supported',
    explain: 'No route between the two within the search scope.',
    className: 'border-status-unsupported/50 text-status-unsupported',
    glyph: 'border border-current',
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
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border font-cond font-semibold uppercase tracking-[0.1em] ${
        size === 'md' ? 'px-2.5 py-1 text-[11px]' : 'px-1.5 py-0.5 text-[10px]'
      } ${meta.className}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 ${meta.glyph}`} />
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
        <span className="font-cond text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-500">
          unchanged
        </span>
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge status={from} short />
      <span aria-hidden="true" className="text-ink-500">
        →
      </span>
      <span className="sr-only">becomes</span>
      <StatusBadge status={to} short />
    </span>
  )
}
