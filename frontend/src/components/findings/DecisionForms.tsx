import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'

import {
  inv,
  type CandidateOut,
  type IdentityState,
  type Kind,
  type ReviewState,
  type Task,
} from '../../api/investigation'
import { plural } from '../../lib/format'
import { ErrorNote, Legend } from '../Instrument'
import { ActionButton, KindLabel, LEGEND, RULE, personText } from './Controls'
import { useDecisions, type DecisionResult, type DecisionStep } from './DecisionContext'
import { useFindingTables } from './FindingTables'
import { candidateText, passages } from './model'

/** Forms that write analyst decisions.
 *
 *  Every one asks for a reason, because the reason is what a later reader of
 *  the history needs. None of them is a hypothetical: those live in the
 *  Challenge surface as scenarios. The copy on each submit says so.
 */

const MIN_REASON = 3

function useSubmit() {
  const { record, busy, version } = useDecisions()
  const [result, setResult] = useState<DecisionResult | null>(null)
  const submit = async (summary: string, steps: DecisionStep[]) => {
    setResult(null)
    setResult(await record(summary, steps))
  }
  return { busy, version, result, submit }
}

function ReasonField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="legend">
        Reason — recorded with your name
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        required
        minLength={MIN_REASON}
        placeholder="What you checked, and what it showed"
        className="mt-1.5 block w-full resize-y border hairline bg-ink-1000 px-2.5 py-2 text-[13px] leading-relaxed text-ink-100 placeholder:text-ink-700"
      />
    </div>
  )
}

function ResultNote({ result }: { result: DecisionResult | null }) {
  if (!result) return null
  if (result.ok) {
    return (
      <p role="status" className="border-l-2 border-signal bg-signal/10 px-3 py-2 text-[12.5px] text-ink-200">
        <span className={`${LEGEND} mr-2 text-signal`}>Recorded</span>
        Workspace is now at version <span className="readout">{result.version}</span>. Findings are being
        recomputed; the earlier version stays in the history.
      </p>
    )
  }
  if (result.conflict) {
    return (
      <p role="alert" className="border-l-2 border-status-lead bg-status-lead/10 px-3 py-2 text-[12.5px] text-ink-200">
        <span className={`${LEGEND} mr-2 text-status-lead`}>Workspace moved on</span>
        {result.message}
      </p>
    )
  }
  return <ErrorNote message={result.message} />
}

function FormShell({
  title,
  description,
  onSubmit,
  onCancel,
  submitLabel,
  canSubmit,
  busy,
  result,
  children,
}: {
  title: string
  description?: ReactNode
  onSubmit: () => void
  onCancel?: () => void
  submitLabel: string
  canSubmit: boolean
  busy: boolean
  result: DecisionResult | null
  children: ReactNode
}) {
  const done = result?.ok === true
  function handle(event: FormEvent) {
    event.preventDefault()
    if (canSubmit && !busy && !done) onSubmit()
  }
  return (
    <form onSubmit={handle} className="rise mt-2 space-y-3 border hairline bg-ink-950/80 p-3">
      <div>
        <p className="font-cond text-[11px] font-semibold uppercase tracking-[0.12em] text-signal">
          Analyst decision · {title}
        </p>
        {description && <div className="mt-1 text-[12.5px] leading-relaxed text-ink-400">{description}</div>}
      </div>
      {!done && children}
      <ResultNote result={result} />
      <div className="flex flex-wrap items-center gap-2">
        {!done && (
          <ActionButton type="submit" variant="primary" disabled={!canSubmit || busy}>
            {busy ? 'Recording…' : submitLabel}
          </ActionButton>
        )}
        {onCancel && (
          <ActionButton variant="link" onClick={onCancel}>
            {done ? 'Close' : 'Cancel'}
          </ActionButton>
        )}
        {!done && (
          <span className="text-[11px] text-ink-500">Writes to the case record. Hypotheticals belong in Challenge.</span>
        )}
      </div>
    </form>
  )
}

// --- One statement -----------------------------------------------------------------

const REVIEW_CHOICES: { value: ReviewState; label: string; meaning: string }[] = [
  { value: 'accepted', label: 'Accept', meaning: 'You checked it against the original and it holds.' },
  { value: 'disputed', label: 'Dispute', meaning: 'You doubt it; it stops counting as support.' },
  { value: 'rejected', label: 'Reject', meaning: 'It is wrong; it stops counting as support.' },
]

export function AssertionReviewForm({
  assertion,
  initialState = 'disputed',
  onClose,
}: {
  assertion: string
  initialState?: ReviewState
  onClose?: () => void
}) {
  const { workspaceId } = useDecisions()
  const { evidence } = useFindingTables()
  const { busy, result, submit } = useSubmit()
  const [state, setState] = useState<ReviewState>(initialState)
  const [reason, setReason] = useState('')
  const [wholePassage, setWholePassage] = useState(true)
  const groupName = useId()

  const item = evidence[assertion]
  // Siblings visible in this finding; the server applies the rule to the whole
  // original, so there may be more than are listed here.
  const siblings = useMemo(() => {
    if (!item) return 0
    const all = passages(Object.keys(evidence), evidence)
    const own = all.find((p) => p.members.includes(assertion))
    return own ? own.members.length - 1 : 0
  }, [assertion, evidence, item])

  return (
    <FormShell
      title="Review this passage"
      description={item ? <>“{item.summary}” in {item.document?.filename ?? 'an unnamed original'}</> : assertion}
      onSubmit={() =>
        void submit(`${state} ${item?.summary ?? assertion}`, [
          (expected) =>
            inv.reviewAssertion(workspaceId, {
              assertion,
              state,
              reason: reason.trim(),
              expected_version: expected,
              whole_passage: wholePassage,
            }),
        ])
      }
      onCancel={onClose}
      submitLabel="Record review"
      canSubmit={reason.trim().length >= MIN_REASON}
      busy={busy}
      result={result}
    >
      <fieldset>
        <legend className="legend">Your reading</legend>
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
          {REVIEW_CHOICES.map((choice) => (
            <label
              key={choice.value}
              className={`flex cursor-pointer items-start gap-2 border px-2.5 py-2 transition-colors ${
                state === choice.value ? 'border-signal bg-signal/10' : `${RULE} hover:border-ink-700`
              }`}
            >
              <input
                type="radio"
                name={groupName}
                value={choice.value}
                checked={state === choice.value}
                onChange={() => setState(choice.value)}
                className="mt-0.5 accent-signal"
              />
              <span>
                <span className="block text-[12.5px] font-medium text-ink-100">{choice.label}</span>
                <span className="block text-[11.5px] leading-snug text-ink-500">{choice.meaning}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start gap-2 text-[12.5px] text-ink-200">
        <input
          type="checkbox"
          checked={wholePassage}
          onChange={(event) => setWholePassage(event.target.checked)}
          className="mt-0.5 accent-signal"
        />
        <span>
          Apply to the whole passage
          <span className="block text-[11.5px] text-ink-500">
            Every statement read from the same sentence or row
            {siblings > 0 ? ` (${plural(siblings, 'other statement')} in this finding)` : ''}. A sentence that
            misreads a number misreads what it says with it.
          </span>
        </span>
      </label>
      <ReasonField value={reason} onChange={setReason} />
    </FormShell>
  )
}

// --- Several passages at once -----------------------------------------------------

/** Records one state on a set of statements, one call per passage. Used for
 *  "Anil Borade held it" (dispute every claim naming someone else) and for
 *  "the rows check out" (accept every row the task names). */
export function PassageDecisionForm({
  title,
  description,
  keys,
  state,
  submitLabel,
  onClose,
  fallbackSummaries,
}: {
  title: string
  description: ReactNode
  keys: string[]
  state: ReviewState
  submitLabel: string
  onClose?: () => void
  fallbackSummaries?: Record<string, { summary: string; kind: Kind; document: string | null }>
}) {
  const { workspaceId } = useDecisions()
  const { evidence } = useFindingTables()
  const { busy, result, submit } = useSubmit()
  const [reason, setReason] = useState('')
  const groups = useMemo(() => passages(keys, evidence), [keys, evidence])

  return (
    <FormShell
      title={title}
      description={description}
      onSubmit={() =>
        void submit(
          `${state} ${plural(groups.length, 'passage')}`,
          groups.map(
            (group) => (expected: number) =>
              inv.reviewAssertion(workspaceId, {
                assertion: group.members[0],
                state,
                reason: reason.trim(),
                expected_version: expected,
                whole_passage: true,
              }),
          ),
        )
      }
      onCancel={onClose}
      submitLabel={submitLabel}
      canSubmit={reason.trim().length >= MIN_REASON && groups.length > 0}
      busy={busy}
      result={result}
    >
      <div>
        <Legend>
          {plural(groups.length, 'passage')} · {plural(keys.length, 'statement')} · marked {state}
        </Legend>
        <ul className="mt-1.5 space-y-1">
          {groups.map((group) => {
            const lead = group.lead
            const fallback = fallbackSummaries?.[group.members[0]]
            return (
              <li key={group.key} className="flex items-start gap-2 text-[12px] text-ink-200">
                <KindLabel kind={lead?.kind ?? fallback?.kind ?? 'claim'} />
                <span className="min-w-0">
                  <span className="block">{lead?.summary ?? fallback?.summary ?? group.members[0]}</span>
                  <span className="block font-mono text-[11px] text-ink-500">
                    {lead?.document?.filename ?? fallback?.document ?? 'original not named'}
                    {group.members.length > 1 && ` · ${plural(group.members.length, 'statement')}`}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      </div>
      <ReasonField value={reason} onChange={setReason} />
    </FormShell>
  )
}

// --- Identity --------------------------------------------------------------------------

const IDENTITY_CHOICES: { value: IdentityState; label: string; meaning: string }[] = [
  { value: 'accepted', label: 'Same person', meaning: 'Cite what shows it. Joins the two references.' },
  { value: 'rejected', label: 'Different people', meaning: 'Keeps the references apart for good.' },
  { value: 'deferred', label: 'Defer', meaning: 'Inconclusive for now; stays unconfirmed.' },
]

export function IdentityDecisionForm({
  candidate,
  initialState = 'accepted',
  extraEvidence = [],
  onClose,
}: {
  candidate: CandidateOut
  initialState?: IdentityState
  extraEvidence?: { key: string; summary: string; kind: Kind; document: string | null }[]
  onClose?: () => void
}) {
  const { workspaceId } = useDecisions()
  const { evidence, people } = useFindingTables()
  const { busy, result, submit } = useSubmit()
  const [state, setState] = useState<IdentityState>(initialState)
  const [reason, setReason] = useState('')
  const [cited, setCited] = useState<Set<string>>(new Set())
  const groupName = useId()

  // What the candidate was proposed on, then anything else the task points to.
  const options = useMemo(() => {
    const seen = new Set<string>()
    const out: { key: string; summary: string; kind: Kind; document: string | null; identifier: string | null; active: boolean }[] = []
    for (const shared of candidate.shared) {
      for (const key of shared.evidence) {
        if (seen.has(key)) continue
        seen.add(key)
        const item = evidence[key]
        out.push({
          key,
          summary: item?.summary ?? key,
          kind: item?.kind ?? 'record',
          document: item?.document?.filename ?? null,
          identifier: shared.identifier,
          active: item?.active ?? true,
        })
      }
    }
    for (const extra of extraEvidence) {
      if (seen.has(extra.key)) continue
      seen.add(extra.key)
      out.push({ ...extra, identifier: null, active: evidence[extra.key]?.active ?? true })
    }
    return out
  }, [candidate.shared, evidence, extraEvidence])

  const needsEvidence = state === 'accepted'
  const canSubmit = reason.trim().length >= MIN_REASON && (!needsEvidence || cited.size > 0)

  function toggle(key: string) {
    setCited((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <FormShell
      title="Identity"
      description={<>Are {candidateText(candidate, people)} one person?</>}
      onSubmit={() =>
        void submit(`${state} identity ${personText(people[candidate.a])} / ${personText(people[candidate.b])}`, [
          (expected) =>
            inv.decideIdentity(workspaceId, {
              candidate: candidate.key,
              state,
              evidence: [...cited],
              reason: reason.trim(),
              expected_version: expected,
            }),
        ])
      }
      onCancel={onClose}
      submitLabel="Record identity decision"
      canSubmit={canSubmit}
      busy={busy}
      result={result}
    >
      <fieldset>
        <legend className="legend">Decision</legend>
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
          {IDENTITY_CHOICES.map((choice) => (
            <label
              key={choice.value}
              className={`flex cursor-pointer items-start gap-2 border px-2.5 py-2 transition-colors ${
                state === choice.value ? 'border-signal bg-signal/10' : `${RULE} hover:border-ink-700`
              }`}
            >
              <input
                type="radio"
                name={groupName}
                value={choice.value}
                checked={state === choice.value}
                onChange={() => setState(choice.value)}
                className="mt-0.5 accent-signal"
              />
              <span>
                <span className="block text-[12.5px] font-medium text-ink-100">{choice.label}</span>
                <span className="block text-[11.5px] leading-snug text-ink-500">{choice.meaning}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="legend">
          Evidence cited {needsEvidence ? '— required to accept' : '— optional'}
        </legend>
        {options.length === 0 ? (
          <p className="mt-1.5 text-[12px] text-ink-500">
            No shared identifier is on file for this pair; it was proposed on the name alone. Nothing here can be
            cited to accept it.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {options.map((option) => (
              <li key={option.key}>
                <label
                  className={`flex items-start gap-2 text-[12px] ${option.active ? 'cursor-pointer text-ink-200' : 'text-ink-500'}`}
                >
                  <input
                    type="checkbox"
                    checked={cited.has(option.key)}
                    disabled={!option.active}
                    onChange={() => toggle(option.key)}
                    className="mt-0.5 accent-signal"
                  />
                  <KindLabel kind={option.kind} />
                  <span className="min-w-0">
                    <span className="block">{option.summary}</span>
                    <span className="block font-mono text-[11px] text-ink-500">
                      {option.document ?? 'original not named'}
                      {option.identifier && ` · shares ${option.identifier}`}
                      {!option.active && ' · not in use, cannot be cited'}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <ReasonField value={reason} onChange={setReason} />
    </FormShell>
  )
}

// --- What a check found ---------------------------------------------------------------------

/** Records the answer to a verification task in one call. The server turns it
 *  into every review, identity or grouping decision the answer implies, under
 *  one workspace version, so the history shows one check by one person rather
 *  than a scatter of separate edits. */
export function TaskOutcomeForm({
  task,
  outcome,
  consequence,
  onClose,
}: {
  task: Task
  outcome: Task['outcomes'][number]
  consequence: ReactNode
  onClose?: () => void
}) {
  const { workspaceId } = useDecisions()
  const { busy, result, submit } = useSubmit()
  const [reason, setReason] = useState('')

  return (
    <FormShell
      title={outcome.label}
      description={consequence}
      onSubmit={() =>
        void submit(`${task.title} ${outcome.label}`, [
          (expected) =>
            inv.recordOutcome(workspaceId, task.key, {
              outcome: outcome.key,
              reason: reason.trim(),
              expected_version: expected,
            }),
        ])
      }
      onCancel={onClose}
      submitLabel="Record this answer"
      canSubmit={reason.trim().length >= MIN_REASON}
      busy={busy}
      result={result}
    >
      <ReasonField value={reason} onChange={setReason} />
    </FormShell>
  )
}

// --- Source grouping -----------------------------------------------------------------------

export function GroupingDecisionForm({
  links,
  state,
  origin,
  derivative,
  onClose,
}: {
  links: string[]
  state: 'accepted' | 'rejected'
  origin: string
  derivative: string
  onClose?: () => void
}) {
  const { workspaceId } = useDecisions()
  const { busy, result, submit } = useSubmit()
  const [reason, setReason] = useState('')

  return (
    <FormShell
      title={state === 'accepted' ? 'It repeats the origin' : 'It is independent'}
      description={
        state === 'accepted' ? (
          <>
            Record that <span className="font-mono">{derivative}</span> repeats{' '}
            <span className="font-mono">{origin}</span>. The two count as one origin, not as corroboration.
          </>
        ) : (
          <>
            Record that <span className="font-mono">{derivative}</span> is independent of{' '}
            <span className="font-mono">{origin}</span>. Each then counts as its own origin.
          </>
        )
      }
      onSubmit={() =>
        void submit(
          `${state} grouping of ${derivative} with ${origin}`,
          links.map(
            (link) => (expected: number) =>
              inv.decideGrouping(workspaceId, { link, state, reason: reason.trim(), expected_version: expected }),
          ),
        )
      }
      onCancel={onClose}
      submitLabel={`Record for ${plural(links.length, 'link')}`}
      canSubmit={reason.trim().length >= MIN_REASON && links.length > 0}
      busy={busy}
      result={result}
    >
      <ReasonField value={reason} onChange={setReason} />
    </FormShell>
  )
}
