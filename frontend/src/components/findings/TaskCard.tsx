import { useMemo, useState } from 'react'

import type { FindingDetail, Task, TaskGrounds } from '../../api/investigation'
import { plural } from '../../lib/format'
import { FieldLabel } from '../../ui'
import { Button, KindLabel, StatStrip, Chip, type Tone } from './shared'
import { TaskOutcomeForm } from './DecisionForms'
import EvidenceRow from './EvidenceRow'
import type { TryScenario } from './SensitivityPanel'
import { StatusChange } from './StatusBadge'
import { TASK_KIND } from './model'
import { readableDates } from '../../ui/copy'

/** One verification task: the question, what to read to answer it, what each
 *  answer would change, and a way to record the answer.
 *
 *  The priority components are shown as they are: what prompts the check, how
 *  many findings and explanations an answer could move, how much reading it
 *  takes, whether the material is already in the workspace. There is no
 *  blended score; the investigator weighs them.
 */

type Outcome = Task['outcomes'][number]

const GROUNDS: Record<TaskGrounds, { tone: Tone; note: string }> = {
  contradiction: {
    tone: 'signal',
    note: 'Two sources already disagree about this. Checked first.',
  },
  'unreviewed assumption': {
    tone: 'lead',
    note: 'Something the findings assume that nobody has reviewed.',
  },
  'single-source dependency': {
    tone: 'neutral',
    note: 'Nothing contradicts this source, but a finding rests on it alone.',
  },
}

/** What recording an answer writes to the case record, said before it is. */
function consequence(task: Task, outcome: Outcome): string {
  const who = outcome.label.replace(/ held it then$/, '')
  switch (task.kind) {
    case 'attribution':
      return outcome.key.startsWith('holder:')
        ? `Disputes every passage that names anyone other than ${who} as the holder over those dates, and the copies repeating them. ${who}'s record is marked as checked.`
        : 'Records that you checked and could not tell. No statement changes.'
    case 'identity':
      if (outcome.key === 'accept') {
        return 'Joins the two references as one person, citing the evidence listed above.'
      }
      return outcome.key === 'reject'
        ? 'Keeps the two references apart for good.'
        : 'Defers the question: the identity stays unconfirmed.'
    case 'lineage':
      return outcome.key === 'independent'
        ? 'Splits the grouping: each document counts as its own origin.'
        : 'Confirms the grouping: the two count as one origin, not as corroboration.'
    case 'critical_source':
      return outcome.key === 'unreliable'
        ? 'Rejects every statement from this source. Findings that rest on it alone lose that support.'
        : 'Marks the rows listed above as checked against the original.'
    default:
      return 'Records this answer.'
  }
}

export default function TaskCard({
  task,
  detail,
  onTry,
}: {
  task: Task
  detail: FindingDetail
  onTry: TryScenario
}) {
  const [open, setOpen] = useState<string | null>(null)
  const meta = TASK_KIND[task.kind] ?? {
    label: task.kind,
    effort: (n: number) => `${plural(n, 'item')} to read`,
  }
  const grounds = GROUNDS[task.grounds] ?? GROUNDS['unreviewed assumption']

  // The derivative and its origin, for comparing the two side by side.
  const lineagePair = useMemo(() => {
    if (task.kind !== 'lineage') return null
    const derived = task.evidence
      .map((item) => detail.evidence[item.key])
      .find((item) => item?.lineage?.origin_document)
    const documents = [
      ...new Set(
        task.evidence.map((item) => item.document ?? 'original not named'),
      ),
    ]
    const derivative = derived?.document?.filename ?? documents[0] ?? 'the copy'
    const origin =
      derived?.lineage?.origin_document ??
      documents.find((doc) => doc !== derivative) ??
      'the origin'
    return { derivative, origin }
  }, [detail.evidence, task])

  return (
    <article className="verification-task">
      <header className="px-4 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <FieldLabel>{meta.label}</FieldLabel>
          <Chip tone={grounds.tone} title={grounds.note}>
            {task.grounds}
          </Chip>
          {task.status_changes > 0 ? (
            <Chip tone="lead">
              Could change {plural(task.status_changes, 'finding')}
            </Chip>
          ) : (
            <Chip tone="muted">Changes no finding's status</Chip>
          )}
        </div>
        <h3 className="mt-1.5 text-base font-medium leading-snug text-heading">
          {readableDates(task.title)}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-body">
          {readableDates(task.question)}
        </p>
        <p className="mt-1 text-xs text-muted">{grounds.note}</p>
      </header>

      <div className="mt-3 px-4">
        <StatStrip
          cells={[
            {
              label: 'Status changes',
              value: plural(task.status_changes, 'finding'),
              title:
                'Findings whose status differs between the possible answers.',
            },
            {
              label: 'Chain changes',
              value: task.explanation_changes,
              title:
                'Explanations that appear or disappear between the possible answers.',
            },
            { label: 'Effort', value: meta.effort(task.effort) },
            { label: 'Availability', value: task.availability },
          ]}
        />
      </div>

      <div className="mt-3 px-4">
        <FieldLabel>What to inspect · {task.evidence.length}</FieldLabel>
        {lineagePair ? (
          <div className="mt-1.5 grid gap-px border border-border bg-border md:grid-cols-2">
            {[lineagePair.derivative, lineagePair.origin].map(
              (document, index) => (
                <div key={document} className="bg-canvas px-3 py-2">
                  <p className="field-label">
                    {index === 0 ? 'Possible copy' : 'Proposed origin'} ·{' '}
                    <span className="font-mono normal-case tracking-normal text-body">
                      {document}
                    </span>
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {task.evidence
                      .filter(
                        (item) =>
                          (item.document ?? 'original not named') === document,
                      )
                      .map((item) =>
                        detail.evidence[item.key] ? (
                          <EvidenceRow
                            key={item.key}
                            evidenceKey={item.key}
                            allowReview={false}
                          />
                        ) : (
                          <PlainEvidence key={item.key} item={item} />
                        ),
                      )}
                  </div>
                </div>
              ),
            )}
          </div>
        ) : (
          <div className="mt-1.5 space-y-1.5">
            {task.evidence.map((item) =>
              detail.evidence[item.key] ? (
                <EvidenceRow key={item.key} evidenceKey={item.key} />
              ) : (
                <PlainEvidence key={item.key} item={item} />
              ),
            )}
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-border px-4 py-3">
        <FieldLabel>Possible answers and what each would change</FieldLabel>
        <ul className="mt-2 divide-y divide-border border border-border">
          {task.outcomes.map((outcome) => {
            const hasOverrides = Object.keys(outcome.overrides).length > 0
            return (
              <li key={outcome.key} className="px-3 py-2.5">
                <div className="grid gap-2 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
                  <p className="text-sm font-medium text-heading">
                    {outcome.label}
                  </p>
                  <div>
                    {outcome.changes.length === 0 ? (
                      <p className="text-xs text-muted">
                        No finding changes status.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {outcome.changes.map((change) => (
                          <li
                            key={change.finding}
                            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-body"
                          >
                            <span>{change.title}</span>
                            <StatusChange from={change.from} to={change.to} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    aria-expanded={open === outcome.key}
                    onClick={() =>
                      setOpen(open === outcome.key ? null : outcome.key)
                    }
                  >
                    Record: {outcome.label}
                  </Button>
                  {hasOverrides && (
                    <Button
                      variant="link"
                      onClick={() =>
                        onTry(
                          `${task.title} — ${outcome.label}`,
                          outcome.overrides,
                        )
                      }
                    >
                      Try as scenario
                    </Button>
                  )}
                </div>

                {open === outcome.key && (
                  <TaskOutcomeForm
                    task={task}
                    outcome={outcome}
                    consequence={consequence(task, outcome)}
                    onClose={() => setOpen(null)}
                  />
                )}
              </li>
            )
          })}
        </ul>
        {task.affected.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            Bears on: {task.affected.map((item) => item.title).join('; ')}.
          </p>
        )}
      </div>
    </article>
  )
}

function PlainEvidence({ item }: { item: Task['evidence'][number] }) {
  return (
    <div className="flex items-start gap-2 border-l-2 border-line py-1 pl-3">
      <KindLabel kind={item.kind} />
      <span className="min-w-0">
        <span className="block text-sm text-heading">{item.summary}</span>
        <span className="block font-mono text-xs text-muted">
          {item.document ?? 'original not named'}
        </span>
      </span>
    </div>
  )
}
