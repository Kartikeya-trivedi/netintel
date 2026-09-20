import type { FindingDetail, History, Status } from '../../api/investigation'
import { formatDateTime } from '../../lib/format'
import { LoadingState } from '../../ui'
import { Callout, SectionHeading, Chip } from './shared'
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
          Checks that could change this finding, or that its explanations depend
          on. Each shows what every possible answer would change; record the
          answer once you have checked the original.
        </SectionHeading>
        {detail.tasks.length === 0 ? (
          <Callout>
            No open verification task bears on this finding under the current
            decisions.
          </Callout>
        ) : (
          <div className="space-y-4">
            {detail.tasks.map((task) => (
              <TaskCard
                key={task.key}
                task={task}
                detail={detail}
                onTry={onTry}
              />
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
  const chronological = [...detail.history].sort(
    (a, b) => a.version - b.version,
  )
  chronological.forEach((entry, index) => {
    if (index > 0) previous.set(entry.version, chronological[index - 1].status)
  })

  return (
    <section className="space-y-3">
      <SectionHeading title={`History of this finding · ${entries.length}`}>
        Every decision adds a version and recomputes the finding. Earlier
        interpretations are kept, not overwritten.
      </SectionHeading>
      {entries.length === 0 ? (
        <Callout>No versions recorded.</Callout>
      ) : (
        <ol className="border-l border-border">
          {entries.map((entry, index) => {
            const before = previous.get(entry.version)
            return (
              <li key={entry.version} className="relative pb-3 pl-4 last:pb-0">
                <span
                  aria-hidden="true"
                  className={`absolute -left-[4.5px] top-1.5 h-2 w-2 ${index === 0 ? 'bg-primary' : 'border border-muted bg-canvas'}`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="numeric text-xs text-heading">
                    v{entry.version}
                  </span>
                  {index === 0 && <Chip tone="signal">Current</Chip>}
                  {before !== undefined ? (
                    <StatusChange from={before} to={entry.status} />
                  ) : (
                    <StatusBadge status={entry.status} short />
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-body">
                  {entry.reason}
                </p>
                <p className="text-xs text-muted">
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
  const decisions = history
    ? [...history.decisions].sort((a, b) => b.version - a.version)
    : []

  function target(type: string, key: string): string {
    if (type === 'identity_decisions' && candidates[key])
      return candidateText(candidates[key], people)
    if (type === 'assertion_reviews' && evidence[key]) {
      const item = evidence[key]
      return `${item.summary} (${item.document?.filename ?? 'original not named'})`
    }
    if (type === 'grouping_decisions') return `source link ${key}`
    return key
  }

  return (
    <section className="space-y-3">
      <SectionHeading
        title={`Decisions in this workspace · ${decisions.length}`}
      >
        Analyst decisions across every finding, newest first. Where a decision
        touches this finding's statements it is described in full; others show
        their key.
      </SectionHeading>
      {loading && !history && <LoadingState label="Reading decisions" />}
      {history && decisions.length === 0 && (
        <Callout>
          No decisions recorded yet. The findings above are the system's
          baseline reading of the originals for {detail.title}.
        </Callout>
      )}
      {decisions.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {decisions.map((decision, index) => (
            <li
              key={`${decision.version}-${decision.type}-${decision.target}-${index}`}
              className="px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="numeric text-xs text-heading">
                  v{decision.version}
                </span>
                <Chip tone="signal">Analyst decision</Chip>
                <span className="field-label">
                  {DECISION_TYPE[decision.type] ?? decision.type}
                </span>
                <span className="text-xs font-semibold text-body">
                  {decision.state}
                </span>
              </div>
              <p className="mt-1 text-sm text-body">
                {target(decision.type, decision.target)}
              </p>
              <p className="mt-0.5 text-xs italic text-body">
                “{decision.reason}”
              </p>
              <p className="text-xs text-muted">
                {decision.actor ?? 'unknown actor'} ·{' '}
                {formatDateTime(decision.at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
