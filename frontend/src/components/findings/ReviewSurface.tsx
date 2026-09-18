import type { FindingDetail, History, Status } from '../../api/investigation'
import { formatDateTime } from '../../lib/format'
import { Spinner } from '../Instrument'
import { Note, SectionHeading, Tag } from './Controls'
import ExportPanel from './ExportPanel'
import { useFindingTables } from './FindingTables'
import type { TryScenario } from './SensitivityPanel'
import StatusBadge, { StatusChange } from './StatusBadge'
import TaskCard from './TaskCard'
import { candidateText } from './model'

/** Surface 4: what to check next, what has been decided, and the export.
 *
 *  Decisions made here are written to the case record with a reason and a
 *  version. Earlier versions are never overwritten: the history below is the
 *  finding as each successive set of decisions left it.
 */

const DECISION_TYPE: Record<string, string> = {
  identity_decisions: 'Identity',
  assertion_reviews: 'Passage review',
  grouping_decisions: 'Source grouping',
}

export default function ReviewSurface({
  detail,
  workspaceId,
  version,
  scope,
  revision,
  history,
  historyLoading,
  onTry,
}: {
  detail: FindingDetail
  workspaceId: number
  version: number | null
  scope: string
  revision: number
  history: History | null
  historyLoading: boolean
  onTry: TryScenario
}) {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeading title={`Verification tasks · ${detail.tasks.length}`}>
          Checks that could change this finding, or that its explanations depend on. Each shows what every possible
          answer would change; record the answer once you have checked the original.
        </SectionHeading>
        {detail.tasks.length === 0 ? (
          <Note>No open verification task bears on this finding under the current decisions.</Note>
        ) : (
          <div className="space-y-4">
            {detail.tasks.map((task) => (
              <TaskCard key={task.key} task={task} detail={detail} onTry={onTry} />
            ))}
          </div>
        )}
      </section>

      <FindingHistory detail={detail} />

      <DecisionLog history={history} loading={historyLoading} detail={detail} />

      <ExportPanel
        workspaceId={workspaceId}
        findingKey={detail.key}
        version={version}
        scope={scope}
        revision={revision}
      />
    </div>
  )
}

function FindingHistory({ detail }: { detail: FindingDetail }) {
  const entries = [...detail.history].sort((a, b) => b.version - a.version)
  const previous = new Map<number, Status>()
  const chronological = [...detail.history].sort((a, b) => a.version - b.version)
  chronological.forEach((entry, index) => {
    if (index > 0) previous.set(entry.version, chronological[index - 1].status)
  })

  return (
    <section className="space-y-3">
      <SectionHeading title={`History of this finding · ${entries.length}`}>
        Every decision adds a version and recomputes the finding. Earlier interpretations are kept, not overwritten.
      </SectionHeading>
      {entries.length === 0 ? (
        <Note>No versions recorded.</Note>
      ) : (
        <ol className="border-l hairline">
          {entries.map((entry, index) => {
            const before = previous.get(entry.version)
            return (
              <li key={entry.version} className="relative pb-3 pl-4 last:pb-0">
                <span
                  aria-hidden="true"
                  className={`absolute -left-[4.5px] top-1.5 h-2 w-2 ${index === 0 ? 'bg-signal' : 'border border-ink-500 bg-ink-1000'}`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="readout text-[12px] text-ink-100">v{entry.version}</span>
                  {index === 0 && <Tag tone="signal">Current</Tag>}
                  {before !== undefined ? <StatusChange from={before} to={entry.status} /> : <StatusBadge status={entry.status} short />}
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-200">{entry.reason}</p>
                <p className="text-[11px] text-ink-500">
                  {entry.actor} · {formatDateTime(entry.at)}
                </p>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function DecisionLog({
  history,
  loading,
  detail,
}: {
  history: History | null
  loading: boolean
  detail: FindingDetail
}) {
  const { evidence, candidates, people } = useFindingTables()
  const decisions = history ? [...history.decisions].sort((a, b) => b.version - a.version) : []

  function target(type: string, key: string): string {
    if (type === 'identity_decisions' && candidates[key]) return candidateText(candidates[key], people)
    if (type === 'assertion_reviews' && evidence[key]) {
      const item = evidence[key]
      return `${item.summary} (${item.document?.filename ?? 'original not named'})`
    }
    if (type === 'grouping_decisions') return `source link ${key}`
    return key
  }

  return (
    <section className="space-y-3">
      <SectionHeading title={`Decisions in this workspace · ${decisions.length}`}>
        Analyst decisions across every finding, newest first. Where a decision touches this finding's statements it
        is described in full; others show their key.
      </SectionHeading>
      {loading && !history && <Spinner label="Reading decisions" />}
      {history && decisions.length === 0 && (
        <Note>
          No decisions recorded yet. The findings above are the system's baseline reading of the originals for{' '}
          {detail.title}.
        </Note>
      )}
      {decisions.length > 0 && (
        <ul className="divide-y divide-rule border hairline">
          {decisions.map((decision, index) => (
            <li key={`${decision.version}-${decision.type}-${decision.target}-${index}`} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="readout text-[11.5px] text-ink-100">v{decision.version}</span>
                <Tag tone="signal">Analyst decision</Tag>
                <span className="legend">{DECISION_TYPE[decision.type] ?? decision.type}</span>
                <span className="font-cond text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-200">
                  {decision.state}
                </span>
              </div>
              <p className="mt-1 text-[12.5px] text-ink-200">{target(decision.type, decision.target)}</p>
              <p className="mt-0.5 text-[12px] italic text-ink-400">“{decision.reason}”</p>
              <p className="text-[11px] text-ink-500">
                {decision.actor ?? 'unknown actor'} · {formatDateTime(decision.at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
