import { useRef, useState, type KeyboardEvent } from 'react'

import { Search } from '../../ui/Symbols'
import type { FindingSummary, Status } from '../../api/investigation'
import { plural } from '../../lib/format'
import { FieldLabel, LoadingPane } from '../../ui'
import { readableDates } from '../../ui/copy'
import { ChainLine } from './shared'
import StatusBadge from './StatusBadge'

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
  selectOnFocus = true,
}: {
  findings: FindingSummary[]
  retired: RetiredFinding[]
  selectedKey: string | null
  onSelect: (key: string) => void
  loading: boolean
  selectOnFocus?: boolean
}) {
  const list = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const visible = findings.filter(
    (item) =>
      (filter === 'all' || item.status === filter) &&
      `${item.a.label} ${item.a.case} ${item.b.label} ${item.b.case} ${item.headline?.chain.join(' ') ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  const leads = findings.filter((finding) => finding.status === 'lead').length
  const supported = findings.filter(
    (finding) => finding.status === 'supported',
  ).length

  function walk(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key) || !list.current) return
    const buttons = [
      ...list.current.querySelectorAll<HTMLButtonElement>(
        'button[data-finding]',
      ),
    ]
    if (buttons.length === 0) return
    const at = buttons.findIndex((button) => button === document.activeElement)
    let next = at
    if (event.key === 'ArrowDown')
      next = at < 0 ? 0 : Math.min(buttons.length - 1, at + 1)
    if (event.key === 'ArrowUp') next = at < 0 ? 0 : Math.max(0, at - 1)
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = buttons.length - 1
    event.preventDefault()
    const target = buttons[next]
    target.focus()
    const key = target.dataset.finding
    if (selectOnFocus && key && key !== selectedKey) onSelect(key)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="queue-toolbar">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-heading">
            Connections{' '}
            <span className="ml-1 text-sm font-medium text-muted">
              {findings.length}
            </span>
          </h2>
          <span className="text-xs text-muted">{plural(leads, 'lead')}</span>
        </div>
        <label className="relative block">
          <Search
            size={15}
            className="absolute left-3 top-3 text-muted"
            aria-hidden="true"
          />
          <span className="sr-only">Search connections</span>
          <input
            className="w-full pl-9!"
            type="search"
            placeholder="Search people or cases"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div
          className="queue-filters"
          role="group"
          aria-label="Filter connections"
        >
          {[
            { value: 'all', label: 'All' },
            { value: 'lead', label: `Needs review · ${leads}` },
            { value: 'supported', label: `Supported · ${supported}` },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              className="queue-filter"
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {loading && findings.length === 0 && (
        <div className="px-4 py-4">
          <LoadingPane label="Reading findings" compact />
        </div>
      )}

      <div
        ref={list}
        onKeyDown={walk}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <nav aria-label="Findings to review">
          <ol className="queue-list px-3 pb-3">
            {visible.map((finding) => (
              <li key={finding.key}>
                <QueueCard
                  finding={finding}
                  selected={finding.key === selectedKey}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ol>
        </nav>

        {!loading && visible.length === 0 && (
          <p className="px-4 py-6 text-sm leading-relaxed text-muted">
            {findings.length
              ? 'No connections match this search. Try another name or filter.'
              : 'No connections under the current decisions and search limits.'}
          </p>
        )}

        {retired.length > 0 && (
          <section
            aria-label="No longer supported"
            className="border-t border-border"
          >
            <div className="px-4 pb-1 pt-3">
              <FieldLabel>No longer supported · {retired.length}</FieldLabel>
              <p className="mt-1 text-xs leading-snug text-muted">
                Findings an earlier version showed and later decisions removed.
                Kept for the record.
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
                        selected
                          ? 'border-primary bg-subtle'
                          : 'border-transparent hover:bg-subtle'
                      }`}
                    >
                      <StatusBadge status="unsupported" short />
                      <span className="mt-1.5 block text-sm text-body">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        Was{' '}
                        {item.lastStatus === 'lead'
                          ? 'a lead'
                          : item.lastStatus}{' '}
                        at v{item.lastVersion}
                        {item.since !== null &&
                          `; not supported since v${item.since}`}
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
  const caveats = [
    assumptions.provisional_identities > 0 &&
      plural(
        assumptions.provisional_identities,
        'identity to check',
        'identities to check',
      ),
    assumptions.hubs > 0 && 'Hub contact',
    finding.truncated && 'More chains than shown',
  ].filter(Boolean)
  return (
    <button
      type="button"
      data-finding={finding.key}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(finding.key)}
      className="queue-card"
    >
      <span className="queue-item-top">
        <StatusBadge status={finding.status} short />
        <span>{plural(finding.distance, 'hop')}</span>
      </span>
      <span className="queue-person">
        <strong>{finding.a.label}</strong>
        <span>{finding.a.case}</span>
      </span>
      <span className="queue-person">
        <strong>{finding.b.label}</strong>
        <span>{finding.b.case}</span>
      </span>
      <span className="queue-item-counts">
        {plural(counts.documents, 'document')}
        <span>·</span>
        {plural(counts.origins, 'origin')}
      </span>
      {finding.headline && (
        <span className="sr-only">
          <ChainLine chain={finding.headline.chain} />
        </span>
      )}
      <span className="sr-only">
        {plural(counts.records, 'record')} · {plural(counts.claims, 'claim')}
      </span>
      {caveats.length > 0 && (
        <span className="queue-item-assumption">{caveats.join(' · ')}</span>
      )}
      {finding.next_task && (
        <span className="sr-only">
          Next check: {readableDates(finding.next_task.title)}
        </span>
      )}
    </button>
  )
}
