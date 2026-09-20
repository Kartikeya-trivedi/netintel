import type { Chain, ScenarioRun } from '../../api/investigation'
import { formatDateTime, plural } from '../../lib/format'
import { ErrorNote, FieldLabel } from '../../ui'
import { ChainLine, LABEL, Callout, StatStrip, Chip } from './shared'
import StatusBadge, { StatusChange } from './StatusBadge'

/** A scenario's result beside the baseline, finding by finding.
 *
 *  Only a completed run's own result is ever drawn here. A failed run shows
 *  its error and nothing else, so a baseline can never be mistaken for what a
 *  scenario produced.
 */
export default function ScenarioComparison({
  run,
  currentVersion,
  findingKey,
}: {
  run: ScenarioRun
  currentVersion: number | null
  findingKey: string
}) {
  if (run.status === 'failed') {
    return (
      <ErrorNote
        message={`Scenario “${run.name}” failed: ${run.error ?? 'no reason given'}. No result is shown.`}
      />
    )
  }
  if (run.status === 'queued' || run.status === 'running') {
    return (
      <Callout>
        Scenario “{run.name}” is still {run.status}. Its result will appear when
        it completes.
      </Callout>
    )
  }
  if (!run.result) {
    return (
      <Callout tone="signal">
        Scenario “{run.name}” returned no result, so there is nothing to
        compare.
      </Callout>
    )
  }

  const result = run.result
  const stale =
    run.status === 'stale' ||
    (currentVersion !== null && run.baseline_version !== currentVersion)
  const changed = result.findings.filter((finding) => finding.changed).length
  const ordered = [...result.findings].sort(
    (a, b) =>
      Number(b.key === findingKey) - Number(a.key === findingKey) ||
      Number(b.changed) - Number(a.changed) ||
      a.title.localeCompare(b.title),
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FieldLabel>Result</FieldLabel>
        <span className="text-sm text-heading">{run.name}</span>
        <Chip tone="neutral">Hypothetical — nothing recorded</Chip>
        {stale && (
          <Chip
            tone="lead"
            title="Decisions were recorded after this ran; the baseline it compares against has moved."
          >
            Stale: ran at version {run.baseline_version}
            {currentVersion !== null ? `, workspace now ${currentVersion}` : ''}
          </Chip>
        )}
      </div>
      <p className="text-xs text-muted">
        Run {formatDateTime(run.created_at)} against decision version{' '}
        {run.baseline_version}.
      </p>

      <StatStrip
        cells={[
          {
            label: 'Findings changed',
            value: `${changed} of ${result.findings.length}`,
          },
          { label: 'Links removed', value: result.edges.removed },
          { label: 'Links weakened', value: result.edges.weakened },
          { label: 'Links added', value: result.edges.added },
          { label: 'People dropped', value: result.people.removed.length },
          { label: 'People added', value: result.people.added.length },
          {
            label: 'Conflicts',
            value: `${result.conflicts.before} → ${result.conflicts.after}`,
          },
          {
            label: 'Statements used',
            value: `${result.active_assertions.before} → ${result.active_assertions.after}`,
          },
        ]}
      />

      {(result.people.removed.length > 0 || result.people.added.length > 0) && (
        <p className="text-sm text-body">
          {result.people.removed.length > 0 && (
            <>
              No longer connected to anyone in the other files:{' '}
              {result.people.removed.join(', ')}.{' '}
            </>
          )}
          {result.people.added.length > 0 && (
            <>Newly connected: {result.people.added.join(', ')}.</>
          )}
        </p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {ordered.map((finding) => (
          <li
            key={finding.key}
            className={`px-3 py-2.5 ${finding.key === findingKey ? 'bg-subtle/60' : ''}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-heading">
                {finding.title}
                {finding.key === findingKey && (
                  <span className={`${LABEL} ml-2 text-primary`}>
                    This finding
                  </span>
                )}
              </p>
              <StatusChange from={finding.before} to={finding.after} />
            </div>
            <ChainChanges
              label="Lost"
              chains={finding.explanations.lost}
              tone="signal"
            />
            <ChainChanges
              label="Gained"
              chains={finding.explanations.gained}
              tone="supported"
            />
            {finding.explanations.kept.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-muted hover:text-body">
                  Kept {plural(finding.explanations.kept.length, 'chain')}
                </summary>
                <ul className="mt-1 space-y-0.5 pl-3">
                  {finding.explanations.kept.map((chain) => (
                    <li
                      key={chain.key}
                      className="flex flex-wrap items-center gap-2 text-xs text-body"
                    >
                      <StatusBadge status={chain.status} short />
                      <ChainLine chain={chain.chain} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChainChanges({
  label,
  chains,
  tone,
}: {
  label: string
  chains: Chain[]
  tone: 'signal' | 'supported'
}) {
  if (chains.length === 0) return null
  return (
    <div className="mt-1.5">
      <span
        className={`${LABEL} ${tone === 'signal' ? 'text-primary' : 'text-status-supported'}`}
      >
        {label}
      </span>
      <ul className="mt-0.5 space-y-0.5">
        {chains.map((chain) => (
          <li
            key={chain.key}
            className="flex flex-wrap items-center gap-2 text-sm text-body"
          >
            <StatusBadge status={chain.status} short />
            <ChainLine chain={chain.chain} />
          </li>
        ))}
      </ul>
    </div>
  )
}
