import { useEffect, useState } from 'react'

import type {
  Counts,
  Derivation,
  EdgeOut,
  Explanation,
  Step,
} from '../../api/investigation'
import { plural } from '../../lib/format'
import { FieldLabel } from '../../ui'
import CandidateCard from './CandidateCard'
import { Button, LABEL, PersonRef, Chip, personText } from './shared'
import EvidenceRow from './EvidenceRow'
import { useFindingTables } from './FindingTables'
import StatusBadge from './StatusBadge'
import {
  CANDIDATE_STATUS,
  EDGE_GROUPS,
  candidateText,
  chainTokens,
  identityTitle,
} from './model'

/** One chain of people, hop by hop, down to the rows each hop rests on.
 *
 *  Read top to bottom it answers "why is this connection on my screen": each
 *  hop bundles its relationships, each relationship holds while any one of
 *  its derivations holds, and a derivation holds only while every statement
 *  in it does. Contested and unreviewed parts open by default; plain
 *  record-backed ones stay folded until asked for.
 */

export interface FoldCommand {
  open: boolean
  nonce: number
}

export function countsText(counts: Counts): string {
  return [
    plural(counts.observations, 'statement'),
    plural(counts.documents, 'document'),
    plural(counts.origins, 'origin'),
    plural(counts.records, 'record'),
    plural(counts.claims, 'claim'),
  ].join(' · ')
}

export default function ExplanationCard({
  explanation,
  index,
  headline,
  defaultOpen,
  showText,
  fold,
}: {
  explanation: Explanation
  index: number
  headline: boolean
  defaultOpen: boolean
  showText: boolean
  fold: FoldCommand | null
}) {
  const { people } = useFindingTables()
  const [open, setOpen] = useState(defaultOpen)
  const { tokens } = chainTokens(explanation, people)
  const bodyId = `explanation-${explanation.key}`

  useEffect(() => {
    if (fold) setOpen(fold.open)
  }, [fold])

  return (
    <article className="explanation-sheet">
      <header className="px-5 py-4">
        <div className="explanation-topline">
          <h3>
            Chain {String(index + 1).padStart(2, '0')}
            {headline && <span>Primary explanation</span>}
          </h3>
          <StatusBadge status={explanation.status} short />
        </div>
        <div className="explanation-caveats">
          {explanation.provisional.length > 0 && (
            <Chip tone="lead">
              {plural(
                explanation.provisional.length,
                'unconfirmed identity',
                'unconfirmed identities',
              )}
            </Chip>
          )}
          {explanation.hubs.length > 0 && (
            <Chip
              tone="lead"
              title="Someone many unrelated people contact (a driver, a shop). A route through them is a lead, not support."
            >
              Passes high-activity contact
            </Chip>
          )}
          {explanation.contested && (
            <Chip
              tone="signal"
              title="Part of this chain rests on a claim that a record contradicts."
            >
              Contested by a record
            </Chip>
          )}
          {explanation.alternatives > 0 && (
            <Chip
              tone="neutral"
              title="Other routings through the same people (via another case reference of the same name). The one assuming least is shown."
            >
              {plural(explanation.alternatives, 'alternative routing')}
            </Chip>
          )}
        </div>

        <p className="explanation-route">
          {tokens.map((token, position) => (
            <span key={token.keys.join('+')}>
              {position > 0 && (
                <span aria-hidden="true" className="mx-2 text-primary-hover">
                  →
                </span>
              )}
              {position > 0 && <span className="sr-only"> to </span>}
              <span
                className={
                  token.identity?.provisional
                    ? 'underline decoration-status-lead decoration-dotted underline-offset-4'
                    : ''
                }
              >
                {token.label}
              </span>{' '}
              <span className="numeric text-xs text-muted">
                ({token.cases.join(' / ')})
              </span>
              {token.identity && (
                <span className="ml-1 text-xs text-status-lead">
                  {token.identity.provisional
                    ? 'identity unconfirmed'
                    : 'identity accepted'}
                </span>
              )}
              {token.hub && (
                <span className="ml-1 text-xs text-status-lead">
                  high-activity contact
                </span>
              )}
            </span>
          ))}
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <details className="explanation-breakdown">
            <summary>
              {plural(explanation.hops, 'hop')} ·{' '}
              {plural(explanation.counts.observations, 'statement')}
              <span aria-hidden="true">+</span>
            </summary>
            <p>{countsText(explanation.counts)}</p>
          </details>
          <Button
            variant="link"
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide the evidence' : 'Show the evidence'}
          </Button>
        </div>
      </header>

      {open && (
        <ol
          id={bodyId}
          className="divide-y divide-border border-t border-border"
        >
          {explanation.steps.map((step) => (
            <li
              key={`${step.index}-${step.source}-${step.target}`}
              className="explanation-step"
            >
              <StepBlock step={step} showText={showText} fold={fold} />
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

function StepBlock({
  step,
  showText,
  fold,
}: {
  step: Step
  showText: boolean
  fold: FoldCommand | null
}) {
  const { people, candidates } = useFindingTables()
  const source = people[step.source]
  const target = people[step.target]

  if (step.identity) {
    const keys = [
      ...new Set(
        step.edges.flatMap((edge) =>
          edge.derivations.flatMap((d) => d.identity),
        ),
      ),
    ]
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <FieldLabel>Identity step</FieldLabel>
          <Chip tone={step.provisional ? 'lead' : 'signal'}>
            {identityTitle(step.provisional)}
          </Chip>
        </div>
        <p className="mt-1.5 text-sm">
          <PersonRef person={source} fallback={step.source} />
          <span className="mx-2 text-muted">treated as</span>
          <PersonRef person={target} fallback={step.target} />
        </p>
        <div className="mt-2 space-y-2">
          {keys.map((key) =>
            candidates[key] ? (
              <CandidateCard
                key={key}
                candidate={candidates[key]}
                showText={showText}
                compact
              />
            ) : (
              <p key={key} className="text-xs text-muted">
                Identity candidate <span className="font-mono">{key}</span> is
                not included in this response.
              </p>
            ),
          )}
        </div>
      </div>
    )
  }

  const groups = EDGE_GROUPS.map((group) => ({
    ...group,
    edges: step.edges.filter((edge) => edge.type === group.type),
  })).filter((group) => group.edges.length > 0)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <FieldLabel>Hop {step.index + 1}</FieldLabel>
        {step.contested && (
          <Chip
            tone="signal"
            title="Every relationship in this hop rests on something a record contradicts."
          >
            Contested by a record
          </Chip>
        )}
      </div>
      <p className="mt-1.5 text-sm">
        <PersonRef person={source} fallback={step.source} />
        <span aria-hidden="true" className="mx-2 text-primary-hover">
          →
        </span>
        <span className="sr-only"> to </span>
        <PersonRef person={target} fallback={step.target} />
      </p>

      <div className="mt-2.5 space-y-3">
        {groups.map((group) => (
          <section key={group.type}>
            <h4 className={`${LABEL} text-body`}>
              {group.type === 'SAME_AS'
                ? identityTitle(step.provisional)
                : group.title}
            </h4>
            <p className="text-xs text-muted">{group.note}</p>
            <div className="mt-1.5 space-y-2">
              {group.edges.map((edge) => (
                <EdgeBlock
                  key={edge.key}
                  edge={edge}
                  showText={showText}
                  fold={fold}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function EdgeBlock({
  edge,
  showText,
  fold,
}: {
  edge: EdgeOut
  showText: boolean
  fold: FoldCommand | null
}) {
  const { people } = useFindingTables()
  const needsEyes =
    edge.contested ||
    edge.provisional ||
    edge.type === 'CLAIMED' ||
    edge.type === 'SAME_AS'
  const [open, setOpen] = useState(needsEyes)
  const hidden = Math.max(0, edge.derivation_count - edge.derivations.length)
  const panelId = `edge-${edge.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`

  useEffect(() => {
    if (fold) setOpen(fold.open)
  }, [fold])

  return (
    <div className="relationship-section">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2 text-left hover:bg-subtle"
      >
        <span aria-hidden="true" className="numeric w-3 text-xs text-muted">
          {open ? '−' : '+'}
        </span>
        <span className="text-sm text-body">
          {personText(people[edge.source], edge.source)}
          <span aria-hidden="true" className="mx-1.5 text-muted">
            {edge.directed ? '→' : '—'}
          </span>
          <span className="sr-only">{edge.directed ? ' to ' : ' and '}</span>
          {personText(people[edge.target], edge.target)}
        </span>
        <span className="numeric text-xs text-muted">
          {countsText(edge.counts)}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {edge.contested && <Chip tone="signal">Contested by a record</Chip>}
          {edge.provisional && <Chip tone="lead">Unreviewed</Chip>}
          <Chip tone="muted">
            {plural(edge.derivation_count, 'derivation')}
          </Chip>
        </span>
      </button>

      {open && (
        <div id={panelId} className="border-t border-border px-2.5 py-2.5">
          <p className="text-xs text-muted">
            Holds while any one derivation holds. Each derivation needs every
            statement in it.
          </p>
          <ol className="mt-2 space-y-2">
            {edge.derivations.map((derivation, position) => (
              <li key={position}>
                <DerivationGroup
                  derivation={derivation}
                  position={position}
                  total={edge.derivation_count}
                  showText={showText}
                  quoted={
                    new Set(
                      edge.derivations
                        .slice(0, position)
                        .flatMap((earlier) => earlier.evidence),
                    )
                  }
                />
              </li>
            ))}
          </ol>
          {hidden > 0 && (
            <p className="mt-2 border-l-2 border-line pl-3 text-xs text-muted">
              +{plural(hidden, 'more alternative derivation')} not shown. They
              combine the same kinds of statement differently; the counts above
              include them.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function DerivationGroup({
  derivation,
  position,
  total,
  showText,
  quoted,
}: {
  derivation: Derivation
  position: number
  total: number
  showText: boolean
  /** Statements an earlier derivation of this relationship already quoted
   *  in full; they repeat here as one line each. */
  quoted: Set<string>
}) {
  const { candidates, people } = useFindingTables()
  const parts = derivation.evidence.length + derivation.identity.length

  return (
    <div
      className={`border-l-2 pl-2.5 ${derivation.contested ? 'border-primary/70' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="field-label">
          Derivation {position + 1} of {total}
          {parts > 1 ? ' — all of these must hold' : ''}
        </span>
        {derivation.contested && (
          <Chip
            tone="signal"
            title="Rests on a claim that a record contradicts."
          >
            Contested
          </Chip>
        )}
      </div>
      <div className="mt-1 space-y-0.5">
        {derivation.evidence.map((key, at) => (
          <div key={key}>
            {at > 0 && <AndRule />}
            <EvidenceRow
              evidenceKey={key}
              showText={showText}
              compact={quoted.has(key)}
              note={quoted.has(key) ? 'quoted above' : undefined}
            />
          </div>
        ))}
        {derivation.identity.map((key, at) => {
          const candidate = candidates[key]
          return (
            <div key={key}>
              {(at > 0 || derivation.evidence.length > 0) && <AndRule />}
              <p className="border-l-2 border-dotted border-status-lead py-1.5 pl-3 text-sm text-body">
                <span className={`${LABEL} mr-2 text-status-lead`}>
                  Assumes identity
                </span>
                {candidate ? (
                  <>
                    {candidateText(candidate, people)} are one person —{' '}
                    <span className="text-muted">
                      {CANDIDATE_STATUS[candidate.status].toLowerCase()}
                    </span>
                  </>
                ) : (
                  <span className="font-mono">{key}</span>
                )}
              </p>
            </div>
          )
        })}
        {parts === 0 && (
          <p className="text-xs text-muted">
            No statements listed for this derivation.
          </p>
        )}
      </div>
    </div>
  )
}

function AndRule() {
  return (
    <div aria-hidden="true" className="flex items-center gap-2 py-0.5 pl-3">
      <span className="text-xs font-semibold text-muted">and</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
