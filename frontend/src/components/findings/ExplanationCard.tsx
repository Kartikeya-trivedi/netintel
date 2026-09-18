import { useEffect, useState } from 'react'

import type { Counts, Derivation, EdgeOut, Explanation, Step } from '../../api/investigation'
import { plural } from '../../lib/format'
import { Legend } from '../Instrument'
import CandidateCard from './CandidateCard'
import { ActionButton, LEGEND, PersonRef, Tag, personText } from './Controls'
import EvidenceRow from './EvidenceRow'
import { useFindingTables } from './FindingTables'
import StatusBadge from './StatusBadge'
import { CANDIDATE_STATUS, EDGE_GROUPS, candidateText, chainTokens, identityTitle } from './model'

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
    <article className="bezel border hairline bg-ink-950/70">
      <header className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Legend>Explanation {index + 1}</Legend>
          <StatusBadge status={explanation.status} />
          {headline && <Tag tone="neutral">Headline</Tag>}
          {explanation.provisional.length > 0 && (
            <Tag tone="lead">{plural(explanation.provisional.length, 'unconfirmed identity', 'unconfirmed identities')}</Tag>
          )}
          {explanation.hubs.length > 0 && (
            <Tag
              tone="lead"
              title="Someone many unrelated people contact (a driver, a shop). A route through them is a lead, not support."
            >
              Passes high-activity contact
            </Tag>
          )}
          {explanation.contested && (
            <Tag tone="signal" title="Part of this chain rests on a claim that a record contradicts.">
              Contested by a record
            </Tag>
          )}
          {explanation.alternatives > 0 && (
            <Tag
              tone="neutral"
              title="Other routings through the same people (via another case reference of the same name). The one assuming least is shown."
            >
              {plural(explanation.alternatives, 'alternative routing')}
            </Tag>
          )}
        </div>

        <p className="mt-2 text-[14px] leading-relaxed text-ink-100">
          {tokens.map((token, position) => (
            <span key={token.keys.join('+')}>
              {position > 0 && (
                <span aria-hidden="true" className="mx-2 text-signal-dim">
                  →
                </span>
              )}
              {position > 0 && <span className="sr-only"> to </span>}
              <span
                className={
                  token.identity?.provisional ? 'underline decoration-status-lead decoration-dotted underline-offset-4' : ''
                }
              >
                {token.label}
              </span>{' '}
              <span className="readout text-[11px] text-ink-500">({token.cases.join(' / ')})</span>
              {token.identity && (
                <span className="ml-1 text-[11px] text-status-lead">
                  {token.identity.provisional ? 'identity unconfirmed' : 'identity accepted'}
                </span>
              )}
              {token.hub && <span className="ml-1 text-[11px] text-status-lead">high-activity contact</span>}
            </span>
          ))}
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="readout text-[11px] text-ink-500">
            {plural(explanation.hops, 'hop')} · {countsText(explanation.counts)}
          </p>
          <ActionButton variant="link" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide the evidence' : 'Show the evidence'}
          </ActionButton>
        </div>
      </header>

      {open && (
        <ol id={bodyId} className="divide-y divide-rule border-t hairline">
          {explanation.steps.map((step) => (
            <li key={`${step.index}-${step.source}-${step.target}`} className="px-4 py-3">
              <StepBlock step={step} showText={showText} fold={fold} />
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

function StepBlock({ step, showText, fold }: { step: Step; showText: boolean; fold: FoldCommand | null }) {
  const { people, candidates } = useFindingTables()
  const source = people[step.source]
  const target = people[step.target]

  if (step.identity) {
    const keys = [...new Set(step.edges.flatMap((edge) => edge.derivations.flatMap((d) => d.identity)))]
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Legend>Identity step</Legend>
          <Tag tone={step.provisional ? 'lead' : 'signal'}>{identityTitle(step.provisional)}</Tag>
        </div>
        <p className="mt-1.5 text-[13px]">
          <PersonRef person={source} fallback={step.source} />
          <span className="mx-2 text-ink-500">treated as</span>
          <PersonRef person={target} fallback={step.target} />
        </p>
        <div className="mt-2 space-y-2">
          {keys.map((key) =>
            candidates[key] ? (
              <CandidateCard key={key} candidate={candidates[key]} showText={showText} compact />
            ) : (
              <p key={key} className="text-[12px] text-ink-500">
                Identity candidate <span className="font-mono">{key}</span> is not included in this response.
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
        <Legend>Hop {step.index + 1}</Legend>
        {step.contested && (
          <Tag tone="signal" title="Every relationship in this hop rests on something a record contradicts.">
            Contested by a record
          </Tag>
        )}
      </div>
      <p className="mt-1.5 text-[13px]">
        <PersonRef person={source} fallback={step.source} />
        <span aria-hidden="true" className="mx-2 text-signal-dim">
          →
        </span>
        <span className="sr-only"> to </span>
        <PersonRef person={target} fallback={step.target} />
      </p>

      <div className="mt-2.5 space-y-3">
        {groups.map((group) => (
          <section key={group.type}>
            <h4 className={`${LEGEND} text-ink-400`}>
              {group.type === 'SAME_AS' ? identityTitle(step.provisional) : group.title}
            </h4>
            <p className="text-[11.5px] text-ink-500">{group.note}</p>
            <div className="mt-1.5 space-y-2">
              {group.edges.map((edge) => (
                <EdgeBlock key={edge.key} edge={edge} showText={showText} fold={fold} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function EdgeBlock({ edge, showText, fold }: { edge: EdgeOut; showText: boolean; fold: FoldCommand | null }) {
  const { people } = useFindingTables()
  const needsEyes = edge.contested || edge.provisional || edge.type === 'CLAIMED' || edge.type === 'SAME_AS'
  const [open, setOpen] = useState(needsEyes)
  const hidden = Math.max(0, edge.derivation_count - edge.derivations.length)
  const panelId = `edge-${edge.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`

  useEffect(() => {
    if (fold) setOpen(fold.open)
  }, [fold])

  return (
    <div className="border hairline">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2 text-left tint-hover"
      >
        <span aria-hidden="true" className="readout w-3 text-[11px] text-ink-500">
          {open ? '−' : '+'}
        </span>
        <span className="text-[12.5px] text-ink-200">
          {personText(people[edge.source], edge.source)}
          <span aria-hidden="true" className="mx-1.5 text-ink-500">
            {edge.directed ? '→' : '—'}
          </span>
          <span className="sr-only">{edge.directed ? ' to ' : ' and '}</span>
          {personText(people[edge.target], edge.target)}
        </span>
        <span className="readout text-[10.5px] text-ink-500">{countsText(edge.counts)}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {edge.contested && <Tag tone="signal">Contested by a record</Tag>}
          {edge.provisional && <Tag tone="lead">Unreviewed</Tag>}
          <Tag tone="muted">{plural(edge.derivation_count, 'derivation')}</Tag>
        </span>
      </button>

      {open && (
        <div id={panelId} className="border-t hairline px-2.5 py-2.5">
          <p className="text-[11.5px] text-ink-500">
            Holds while any one derivation holds. Each derivation needs every statement in it.
          </p>
          <ol className="mt-2 space-y-2">
            {edge.derivations.map((derivation, position) => (
              <li key={position}>
                <DerivationGroup
                  derivation={derivation}
                  position={position}
                  total={edge.derivation_count}
                  showText={showText}
                  quoted={new Set(edge.derivations.slice(0, position).flatMap((earlier) => earlier.evidence))}
                />
              </li>
            ))}
          </ol>
          {hidden > 0 && (
            <p className="mt-2 border-l-2 border-ink-800 pl-3 text-[11.5px] text-ink-500">
              +{plural(hidden, 'more alternative derivation')} not shown. They combine the same kinds of
              statement differently; the counts above include them.
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
    <div className={`border-l-2 pl-2.5 ${derivation.contested ? 'border-signal/70' : 'border-ink-800'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="legend">
          Derivation {position + 1} of {total}
          {parts > 1 ? ' — all of these must hold' : ''}
        </span>
        {derivation.contested && (
          <Tag tone="signal" title="Rests on a claim that a record contradicts.">
            Contested
          </Tag>
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
              <p className="border-l-2 border-dotted border-status-lead py-1.5 pl-3 text-[12.5px] text-ink-200">
                <span className={`${LEGEND} mr-2 text-status-lead`}>Assumes identity</span>
                {candidate ? (
                  <>
                    {candidateText(candidate, people)} are one person —{' '}
                    <span className="text-ink-500">{CANDIDATE_STATUS[candidate.status].toLowerCase()}</span>
                  </>
                ) : (
                  <span className="font-mono">{key}</span>
                )}
              </p>
            </div>
          )
        })}
        {parts === 0 && <p className="text-[12px] text-ink-500">No statements listed for this derivation.</p>}
      </div>
    </div>
  )
}

function AndRule() {
  return (
    <div aria-hidden="true" className="flex items-center gap-2 py-0.5 pl-3">
      <span className="font-cond text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-700">and</span>
      <span className="h-px flex-1 bg-ink-850" />
    </div>
  )
}
