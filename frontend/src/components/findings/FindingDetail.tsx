import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react'

import {
  inv,
  type Artifact,
  type FindingSummary,
  type History,
  type ScenarioDefinition,
} from '../../api/investigation'
import { ArrowLeftRight, ArrowUpRight } from '../../ui/Symbols'
import { plural, shortCaseName } from '../../lib/format'
import { useScopedAsync } from '../../lib/useApi'
import { ErrorNote, LoadingPane } from '../../ui'
import ChallengeSurface, { type ScenarioPreset } from './ChallengeSurface'
import { Button, PersonRef, StatStrip, Chip } from './shared'
import EvidenceSurface from './EvidenceSurface'
import { FindingTablesContext, type FindingTablesValue } from './FindingTables'
import NetworkTimeSurface from './NetworkTimeSurface'
import ReviewSurface from './ReviewSurface'
import StatusBadge, { STATUS_META } from './StatusBadge'
import { TASK_KIND } from './model'
import { readableDates } from '../../ui/copy'

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
  const detail = useScopedAsync(
    () => inv.finding(workspaceId, key),
    `${scope}|${key}`,
    [revision],
  )
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]))
  const [preset, setPreset] = useState<ScenarioPreset | null>(null)
  const ids = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  useEffect(() => {
    setVisited((current) =>
      current.has(tab) ? current : new Set(current).add(tab),
    )
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
      candidates: Object.fromEntries(
        data.candidates.map((candidate) => [candidate.key, candidate]),
      ),
      artifacts,
    }
  }, [artifacts, detail.data])

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = TABS.findIndex((item) => item.id === tab)
    let next = at
    if (event.key === 'ArrowRight') next = (at + 1) % TABS.length
    else if (event.key === 'ArrowLeft')
      next = (at - 1 + TABS.length) % TABS.length
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
      <header className="finding-intro">
        <div className="finding-heading-row">
          <h2 className="finding-title">
            <PersonRef person={head.a} />
            <ArrowLeftRight size={20} className="finding-pair-arrow" />
            <span className="sr-only"> and </span>
            <PersonRef person={head.b} />
          </h2>
          <StatusBadge status={head.status} />
        </div>
        <div className="finding-facts">
          <dl className="finding-digest">
            <div>
              <dt>Documents</dt>
              <dd>{head.counts.documents}</dd>
            </div>
            <div title="Independent origins: copies and repeats count once.">
              <dt>Origins</dt>
              <dd>{head.counts.origins}</dd>
            </div>
            <div>
              <dt>Records</dt>
              <dd>{head.counts.records}</dd>
            </div>
            <div>
              <dt>Claims</dt>
              <dd>{head.counts.claims}</dd>
            </div>
          </dl>
          <details className="finding-scope">
            <summary>
              Basis & scope<span aria-hidden="true">+</span>
            </summary>
            <div className="finding-scope-body">
              <p>
                {shortCaseName(head.a.case_name, head.a.case)} ·{' '}
                {shortCaseName(head.b.case_name, head.b.case)}
              </p>
              <p>{meta.explain}</p>
              <div className="flex flex-wrap gap-3">
                {head.assumptions.provisional_identities > 0 && (
                  <Chip tone="lead">
                    {plural(
                      head.assumptions.provisional_identities,
                      'unconfirmed identity',
                      'unconfirmed identities',
                    )}
                  </Chip>
                )}
                {head.assumptions.hubs > 0 && (
                  <Chip tone="lead">Passes high-activity contact</Chip>
                )}
                {head.truncated && (
                  <Chip tone="muted">More chains exist than are shown</Chip>
                )}
              </div>
              <StatStrip
                cells={[
                  {
                    label: 'Distance',
                    value: plural(head.distance, 'hop'),
                    title: 'Hops in the shortest chain.',
                  },
                  { label: 'Explanations', value: head.explanation_count },
                  {
                    label: 'Supported',
                    value: head.supported_explanations,
                    title:
                      'Explanations resting on no unreviewed identity and no high-activity contact.',
                  },
                  { label: 'Paths found', value: head.paths_found },
                ]}
              />
              <p>
                A connection says two case files may share people or contacts,
                and shows what it rests on. It is not a finding that anyone took
                part in an offence.
              </p>
            </div>
          </details>
        </div>
        {summary.next_task && (
          <div className="finding-next-action">
            <div>
              <p>
                Next check{' '}
                <span>
                  ·{' '}
                  {TASK_KIND[summary.next_task.kind]?.label ??
                    summary.next_task.kind}
                </span>
              </p>
              <strong>{readableDates(summary.next_task.title)}</strong>
            </div>
            <Button variant="primary" onClick={() => onTab('review')}>
              Review
              <ArrowUpRight size={15} />
            </Button>
          </div>
        )}
      </header>

      <div
        role="tablist"
        aria-label="Finding surfaces"
        onKeyDown={onTabKey}
        className="finding-tabs"
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
              aria-controls={data ? `${ids}-panel-${item.id}` : undefined}
              tabIndex={active ? 0 : -1}
              onClick={() => onTab(item.id)}
            >
              {item.label}
              {count !== null && (
                <span className="numeric text-xs text-muted">{count}</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="finding-content">
        {detail.loading && !detail.data && (
          <LoadingPane label="Opening the finding" />
        )}
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
                  {mounted && item.id === 'evidence' && (
                    <EvidenceSurface detail={data} />
                  )}
                  {mounted && item.id === 'network' && (
                    <NetworkTimeSurface detail={data} />
                  )}
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
