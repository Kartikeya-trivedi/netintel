import { useRef, type KeyboardEvent } from 'react'

import type { FindingSummary, Status } from '../../api/investigation'
import { plural } from '../../lib/format'
import { Legend, Spinner } from '../Instrument'
import { ChainLine, Tag } from './Controls'
import StatusBadge from './StatusBadge'
import { TASK_KIND } from './model'

/** The review queue: one card per connection between accused in two files.
 *
 *  Leads come first because they are what needs a person (the server sorts
 *  them so). Every badge and count is in words; the arrow keys walk the queue
 *  and selection follows focus, so the detail beside it keeps up.
 */

export interface RetiredFinding {
  key: string
  title: string
  lastStatus: Status
  lastVersion: number
  since: number | null
}

export default function FindingQueue({
  findings,
  retired,
  selectedKey,
  onSelect,
  loading,
}: {
  findings: FindingSummary[]
  retired: RetiredFinding[]
  selectedKey: string | null
  onSelect: (key: string) => void
  loading: boolean
}) {
  const list = useRef<HTMLDivElement>(null)
  const leads = findings.filter((finding) => finding.status === 'lead').length
  const supported = findings.filter((finding) => finding.status === 'supported').length

  function walk(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key) || !list.current) return
    const buttons = [...list.current.querySelectorAll<HTMLButtonElement>('button[data-finding]')]
    if (buttons.length === 0) return
    const at = buttons.findIndex((button) => button === document.activeElement)
    let next = at
    if (event.key === 'ArrowDown') next = at < 0 ? 0 : Math.min(buttons.length - 1, at + 1)
    if (event.key === 'ArrowUp') next = at < 0 ? 0 : Math.max(0, at - 1)
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = buttons.length - 1
    event.preventDefault()
    const target = buttons[next]
    target.focus()
    const key = target.dataset.finding
    if (key && key !== selectedKey) onSelect(key)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between gap-3 border-b hairline px-4 py-3">
        <Legend>Findings · {findings.length}</Legend>
        <span className="text-[11px] text-ink-500">
          {plural(leads, 'lead')} · {supported} supported
        </span>
      </div>
      {loading && findings.length === 0 && (
        <div className="px-4 py-4">
          <Spinner label="Reading findings" />
        </div>
      )}

      <div ref={list} onKeyDown={walk} className="min-h-0 flex-1 overflow-y-auto">
        <nav aria-label="Findings to review">
          <ol className="max-h-[22rem] overflow-y-auto lg:max-h-none lg:overflow-visible">
            {findings.map((finding) => (
              <li key={finding.key}>
                <QueueCard finding={finding} selected={finding.key === selectedKey} onSelect={onSelect} />
              </li>
            ))}
          </ol>
        </nav>

        {!loading && findings.length === 0 && (
          <p className="px-4 py-6 text-[12.5px] leading-relaxed text-ink-500">
            No connection between accused in different files under the current decisions and search limits.
          </p>
        )}

        {retired.length > 0 && (
          <section aria-label="No longer supported" className="border-t hairline">
            <div className="px-4 pb-1 pt-3">
              <Legend>No longer supported · {retired.length}</Legend>
              <p className="mt-1 text-[11px] leading-snug text-ink-500">
                Findings an earlier version showed and later decisions removed. Kept for the record.
              </p>
            </div>
            <ol>
              {retired.map((item) => {
                const selected = item.key === selectedKey
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      data-finding={item.key}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => onSelect(item.key)}
                      className={`w-full border-l-2 px-4 py-2.5 text-left transition-colors ${
                        selected ? 'border-signal bg-ink-900' : 'border-transparent tint-hover'
                      }`}
                    >
                      <StatusBadge status="unsupported" short />
                      <span className="mt-1.5 block text-[12.5px] text-ink-400">{item.title}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-500">
                        Was {item.lastStatus === 'lead' ? 'a lead' : item.lastStatus} at v{item.lastVersion}
                        {item.since !== null && `; not supported since v${item.since}`}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        )}
      </div>
    </div>
  )
}

function QueueCard({
  finding,
  selected,
  onSelect,
}: {
  finding: FindingSummary
  selected: boolean
  onSelect: (key: string) => void
}) {
  const { assumptions, counts } = finding
  const supported = finding.status === 'supported'
  return (
    <button
      type="button"
      data-finding={finding.key}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(finding.key)}
      className={`group w-full border-b border-l-2 border-b-[color:var(--rule-color)] px-4 py-3 text-left transition-colors ${
        selected ? 'border-l-signal bg-ink-900' : 'border-l-transparent tint-hover'
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <StatusBadge status={finding.status} />
        <span className="readout text-[10px] text-ink-500">{plural(finding.distance, 'hop')}</span>
      </span>

      <span className="mt-2 block text-[13.5px] font-medium leading-snug text-ink-100">
        {finding.a.label} <span className="readout text-[11px] font-normal text-ink-500">({finding.a.case})</span>
        <span aria-hidden="true" className="mx-1.5 font-normal text-ink-500">
          ↔
        </span>
        <span className="sr-only"> and </span>
        {finding.b.label} <span className="readout text-[11px] font-normal text-ink-500">({finding.b.case})</span>
      </span>

      <span className="mt-1 block text-[12px] text-ink-400">
        {finding.headline ? (
          <ChainLine chain={finding.headline.chain} />
        ) : (
          <span className="text-ink-500">No chain within the search scope</span>
        )}
      </span>

      <span className="readout mt-1.5 block text-[10.5px] leading-relaxed text-ink-500">
        {plural(counts.documents, 'document')} · {plural(counts.origins, 'origin')} · {plural(counts.records, 'record')} ·{' '}
        {plural(counts.claims, 'claim')}
      </span>

      {(assumptions.provisional_identities > 0 || assumptions.hubs > 0 || finding.truncated) && (
        <span className="mt-2 flex flex-wrap gap-1">
          {/* On a supported finding these belong to its other, weaker routes:
              the route that makes it supported assumes neither. */}
          {assumptions.provisional_identities > 0 && (
            <Tag tone={supported ? 'muted' : 'lead'}>
              {supported && 'Other routes: '}
              {plural(assumptions.provisional_identities, 'unconfirmed identity', 'unconfirmed identities')}
            </Tag>
          )}
          {assumptions.hubs > 0 && (
            <Tag tone={supported ? 'muted' : 'lead'}>
              {supported ? 'Other routes pass a high-activity contact' : 'Passes high-activity contact'}
            </Tag>
          )}
          {finding.truncated && <Tag tone="muted">More chains than shown</Tag>}
        </span>
      )}

      {finding.next_task && (
        <span className="mt-2 block border-t border-dashed hairline pt-1.5 text-[11.5px] leading-snug text-ink-400">
          <span className="legend mr-1.5">Next check</span>
          <span className="text-ink-500">{TASK_KIND[finding.next_task.kind]?.label ?? finding.next_task.kind}:</span>{' '}
          {finding.next_task.title}
        </span>
      )}
    </button>
  )
}
