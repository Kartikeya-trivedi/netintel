import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'

import {
  inv,
  type Artifact,
  type FindingSummary,
  type History,
  type ScenarioDefinition,
} from '../../api/investigation'
import { plural, shortCaseName } from '../../lib/format'
import { useScopedAsync } from '../../lib/useApi'
import { ErrorNote, Legend, Spinner } from '../Instrument'
import ChallengeSurface, { type ScenarioPreset } from './ChallengeSurface'
import { ActionButton, PersonRef, ReadoutStrip, Tag } from './Controls'
import EvidenceSurface from './EvidenceSurface'
import { FindingTablesContext, type FindingTablesValue } from './FindingTables'
import NetworkTimeSurface from './NetworkTimeSurface'
import ReviewSurface from './ReviewSurface'
import StatusBadge, { STATUS_META } from './StatusBadge'
import { TASK_KIND } from './model'

/** One finding, opened: a header that says what it is and what it rests on,
 *  then four coordinated surfaces. A surface is mounted the first time it is
 *  opened and kept afterwards, so a scenario built on Challenge is still
 *  there after a look at the evidence. */

export type Tab = 'evidence' | 'network' | 'challenge' | 'review'

export const TABS: { id: Tab; label: string }[] = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'network', label: 'Network & time' },
  { id: 'challenge', label: 'Challenge' },
  { id: 'review', label: 'Review' },
]

export function parseTab(value: string | null): Tab {
  return TABS.some((tab) => tab.id === value) ? (value as Tab) : 'evidence'
}

export default function FindingDetail({
  workspaceId,
  summary,
  tab,
  onTab,
  scope,
  revision,
  version,
  artifacts,
  history,
  historyLoading,
  cases,
}: {
  workspaceId: number
  summary: FindingSummary
  tab: Tab
  onTab: (tab: Tab) => void
  scope: string
  revision: number
  version: number | null
  artifacts: Map<string, Artifact> | null
  history: History | null
  historyLoading: boolean
  cases: { code: string; name: string }[]
}) {
  const key = summary.key
  const detail = useScopedAsync(() => inv.finding(workspaceId, key), `${scope}|${key}`, [revision])
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]))
  const [preset, setPreset] = useState<ScenarioPreset | null>(null)
  const ids = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  useEffect(() => {
    setVisited((current) => (current.has(tab) ? current : new Set(current).add(tab)))
  }, [tab])

  const tryScenario = useCallback(
    (name: string, overrides: Partial<ScenarioDefinition>) => {
      setPreset({ id: Date.now(), name, overrides })
      onTab('challenge')
    },
    [onTab],
  )

  const tables = useMemo<FindingTablesValue | null>(() => {
    const data = detail.data
    if (!data) return null
    return {
      people: data.people,
      evidence: data.evidence,
      families: data.families,
      candidates: Object.fromEntries(data.candidates.map((candidate) => [candidate.key, candidate])),
      artifacts,
    }
  }, [artifacts, detail.data])

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = TABS.findIndex((item) => item.id === tab)
    let next = at
    if (event.key === 'ArrowRight') next = (at + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (at - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    else return
    event.preventDefault()
    onTab(TABS[next].id)
    document.getElementById(`${ids}-tab-${TABS[next].id}`)?.focus()
  }

  const data = detail.data
  const head = data ?? summary
  const meta = STATUS_META[head.status] ?? STATUS_META.unsupported

  return (
    <div>
      <header className="border-b hairline px-5 pb-4 pt-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Legend>
              Finding · {head.case_a} ↔ {head.case_b}
            </Legend>
            <h1 className="mt-1.5 text-[21px] font-semibold leading-tight tracking-tight text-ink-100">
              <PersonRef person={head.a} />
              <span aria-hidden="true" className="mx-2.5 font-normal text-ink-500">
                ↔
              </span>
              <span className="sr-only"> and </span>
              <PersonRef person={head.b} />
            </h1>
            <p className="mt-1 text-[12.5px] text-ink-500">
              {shortCaseName(head.a.case_name, head.a.case)} · {shortCaseName(head.b.case_name, head.b.case)}
            </p>
          </div>
          <StatusBadge status={head.status} size="md" />
        </div>

        <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-ink-400">{meta.explain}</p>

        {(head.assumptions.provisional_identities > 0 || head.assumptions.hubs > 0 || head.truncated) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {head.assumptions.provisional_identities > 0 && (
              <Tag tone="lead">
                {plural(head.assumptions.provisional_identities, 'unconfirmed identity', 'unconfirmed identities')}
              </Tag>
            )}
            {head.assumptions.hubs > 0 && <Tag tone="lead">Passes high-activity contact</Tag>}
            {head.truncated && <Tag tone="muted">More chains exist than are shown</Tag>}
          </div>
        )}

        <div className="mt-4">
          <ReadoutStrip
            cells={[
              { label: 'Distance', value: plural(head.distance, 'hop'), title: 'Hops in the shortest chain.' },
              { label: 'Explanations', value: head.explanation_count },
              {
                label: 'Supported',
                value: head.supported_explanations,
                title: 'Explanations resting on no unreviewed identity and no high-activity contact.',
              },
              { label: 'Paths found', value: head.paths_found },
              { label: 'Documents', value: head.counts.documents },
              {
                label: 'Origins',
                value: head.counts.origins,
                title: 'Independent origins: copies and repeats of one source count once.',
              },
              { label: 'Records', value: head.counts.records, title: 'Rows a system logged.' },
              { label: 'Claims', value: head.counts.claims, title: 'Statements a person or report made.' },
            ]}
          />
        </div>

        {summary.next_task && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-400">
            <Legend>Next check</Legend>
            <span className="text-ink-500">{TASK_KIND[summary.next_task.kind]?.label ?? summary.next_task.kind}:</span>
            <span className="text-ink-200">{summary.next_task.title}</span>
            <ActionButton variant="link" onClick={() => onTab('review')}>
              Open in Review →
            </ActionButton>
          </div>
        )}

        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
          A connection says two case files may share people or contacts, and shows what that rests on. It is not a
          finding that anyone took part in an offence.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Finding surfaces"
        onKeyDown={onTabKey}
        className="sticky top-0 z-10 flex overflow-x-auto border-b hairline bg-ink-1000"
      >
        {TABS.map((item) => {
          const active = item.id === tab
          const count = item.id === 'review' && data ? data.tasks.length : null
          return (
            <button
              key={item.id}
              id={`${ids}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${ids}-panel-${item.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onTab(item.id)}
              className={`relative flex shrink-0 items-center gap-2 border-r hairline px-4 py-2.5 font-cond text-[11.5px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                active ? 'bg-ink-900 text-ink-100' : 'text-ink-500 hover:bg-ink-950 hover:text-ink-200'
              }`}
            >
              {item.label}
              {count !== null && <span className="readout text-[10px] text-ink-500">{count}</span>}
              {active && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-signal" />}
            </button>
          )
        })}
      </div>

      <div className="px-5 py-5 sm:px-6">
        {detail.loading && !detail.data && <Spinner label="Opening the finding" />}
        {detail.error && (
          <ErrorNote
            message={
              detail.status === 404
                ? 'This finding is not in the workspace under the current decisions. It may have been removed by a decision made moments ago; the queue is refreshing.'
                : detail.error
            }
          />
        )}

        {data && tables && (
          <FindingTablesContext.Provider value={tables}>
            {TABS.map((item) => {
              // Every panel exists so each tab's aria-controls resolves; its
              // content mounts on first visit and then stays.
              const mounted = item.id === tab || visited.has(item.id)
              return (
                <div
                  key={item.id}
                  id={`${ids}-panel-${item.id}`}
                  role="tabpanel"
                  aria-labelledby={`${ids}-tab-${item.id}`}
                  hidden={item.id !== tab}
                  tabIndex={0}
                  className="focus-visible:outline-offset-4"
                >
                  {mounted && item.id === 'evidence' && <EvidenceSurface detail={data} />}
                  {mounted && item.id === 'network' && <NetworkTimeSurface detail={data} />}
                  {mounted && item.id === 'challenge' && (
                    <ChallengeSurface
                      detail={data}
                      workspaceId={workspaceId}
                      scope={scope}
                      revision={revision}
                      version={version}
                      cases={cases}
                      preset={preset}
                      onTry={tryScenario}
                    />
                  )}
                  {mounted && item.id === 'review' && (
                    <ReviewSurface
                      detail={data}
                      workspaceId={workspaceId}
                      version={version}
                      scope={scope}
                      revision={revision}
                      history={history}
                      historyLoading={historyLoading}
                      onTry={tryScenario}
                    />
                  )}
                </div>
              )
            })}
          </FindingTablesContext.Provider>
        )}
      </div>
    </div>
  )
}
