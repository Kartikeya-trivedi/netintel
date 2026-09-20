import { useMemo, useState } from 'react'

import type { Contrary, FindingDetail } from '../../api/investigation'
import { formatRange, plural } from '../../lib/format'
import { EmptyState } from '../../ui'
import Popover from '../../ui/Popover'
import CandidateCard from './CandidateCard'
import { Button, Callout, PersonRef, SectionHeading, Chip } from './shared'
import EvidenceRow from './EvidenceRow'
import ExplanationCard, { type FoldCommand } from './ExplanationCard'
import { useFindingTables } from './FindingTables'

/** Surface 1: the exact passages and rows behind every explanation, what
 *  contradicts them, and the identity proposals they lean on. */
export default function EvidenceSurface({ detail }: { detail: FindingDetail }) {
  const [text, setText] = useState<'shown' | 'hidden'>('shown')
  const [fold, setFold] = useState<FoldCommand | null>(null)
  const showText = text === 'shown'

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeading
          title={`Explanations · ${detail.explanations.length}`}
          aside={
            <div className="evidence-browser-tools">
              <Popover label="Reading guide" className="evidence-help">
                <h3>How to read an explanation</h3>
                <p>
                  Each explanation is one chain of people. Every relationship
                  lists the statements it was derived from, quoted from the
                  original.
                </p>
                <p>
                  {plural(detail.paths_found, 'path')} found and grouped into{' '}
                  {plural(detail.explanations.length, 'chain')}.
                  {detail.truncated &&
                    ' More chains exist than are shown here.'}
                </p>
              </Popover>
              <Popover label="Display" className="evidence-display">
                <label>
                  <input
                    type="checkbox"
                    checked={showText}
                    onChange={(event) =>
                      setText(event.target.checked ? 'shown' : 'hidden')
                    }
                  />
                  Show original text
                </label>
                <div className="evidence-fold-actions">
                  <Button
                    onClick={() => setFold({ open: true, nonce: Date.now() })}
                  >
                    Expand all
                  </Button>
                  <Button
                    onClick={() => setFold({ open: false, nonce: Date.now() })}
                  >
                    Collapse all
                  </Button>
                </div>
              </Popover>
            </div>
          }
        >
          {detail.truncated
            ? 'Showing a limited set of chains. More routes exist within the search scope.'
            : null}
        </SectionHeading>

        {detail.explanations.length === 0 ? (
          <EmptyState title="No explanation within the search scope">
            No chain of people joins the two within the current hop limit and
            decisions.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {detail.explanations.map((explanation, index) => (
              <ExplanationCard
                key={explanation.key}
                explanation={explanation}
                index={index}
                headline={detail.headline?.key === explanation.key}
                defaultOpen={index === 0}
                showText={showText}
                fold={fold}
              />
            ))}
          </div>
        )}
      </section>

      <ContrarySection
        contrary={detail.contrary}
        detail={detail}
        showText={showText}
      />

      <section className="space-y-3">
        <SectionHeading
          title={`Identity candidates · ${detail.candidates.length}`}
        >
          Case references this finding joins on the assumption that they are one
          person. A shared name is a proposal to review, not a conclusion.
        </SectionHeading>
        {detail.candidates.length === 0 ? (
          <Callout>
            This finding rests on no identity proposal: every hop stays within
            one case reference.
          </Callout>
        ) : (
          <div className="space-y-2">
            {detail.candidates.map((candidate) => (
              <CandidateCard
                key={candidate.key}
                candidate={candidate}
                showText={showText}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ContrarySection({
  contrary,
  detail,
  showText,
}: {
  contrary: Contrary[]
  detail: FindingDetail
  showText: boolean
}) {
  return (
    <section className="space-y-3">
      <SectionHeading title={`Contrary evidence · ${contrary.length}`}>
        Statements that pull against this finding: the same number attributed to
        different people over the same days, and denials on file.
      </SectionHeading>
      {contrary.length === 0 ? (
        <Callout>
          Nothing on file contradicts the statements this finding uses.
        </Callout>
      ) : (
        <ul className="space-y-3">
          {contrary.map((item, index) => (
            <li key={`${item.kind}-${item.identifier ?? ''}-${index}`}>
              {item.kind === 'attribution' ? (
                <AttributionConflict
                  item={item}
                  detail={detail}
                  showText={showText}
                />
              ) : (
                <Denial item={item} showText={showText} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** "9867012345 on 8–12 May 2026: Anil Borade (record) vs Sameer Khan (claim)". */
function AttributionConflict({
  item,
  detail,
  showText,
}: {
  item: Contrary
  detail: FindingDetail
  showText: boolean
}) {
  const { people, evidence } = useFindingTables()

  // The timeline's holdings say who each holding statement names, which is
  // how the evidence list is split between the holders.
  const byHolder = useMemo(() => {
    const holdingPerson = new Map(
      detail.timeline.holdings.map((h) => [h.key, h.person]),
    )
    const assigned = new Set<string>()
    const groups = item.holders.map((holder) => {
      const label = people[holder]?.label
      const keys = item.evidence.filter(
        (key) => label !== undefined && holdingPerson.get(key) === label,
      )
      keys.forEach((key) => assigned.add(key))
      const kinds = new Set(
        keys.map((key) => evidence[key]?.kind).filter(Boolean),
      )
      const origins = new Set(
        keys.map((key) => evidence[key]?.family).filter(Boolean),
      )
      return { holder, keys, kinds, origins }
    })
    const other = item.evidence.filter((key) => !assigned.has(key))
    return { groups, other }
  }, [detail.timeline.holdings, evidence, item.evidence, item.holders, people])

  function kindWord(kinds: Set<string | undefined>, count: number): string {
    if (count === 0) return 'no holding statement listed'
    if (kinds.size > 1)
      return `${plural(count, 'statement')}, records and claims`
    const kind = [...kinds][0] === 'record' ? 'record' : 'claim'
    return plural(count, kind)
  }

  return (
    <div className="rounded-lg border border-border bg-surface/60">
      <div className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="signal">Attribution conflict</Chip>
          <span className="numeric text-sm text-heading">
            {item.identifier ?? 'identifier not stated'}
          </span>
          <span className="text-sm text-body">
            {formatRange(item.from, item.to)}
            {item.events !== undefined &&
              ` · ${plural(item.events, 'event')} read as more than one person`}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-body">
          {byHolder.groups.map((group, index) => (
            <span key={group.holder}>
              {index > 0 && (
                <span className="mx-2 text-xs text-primary">vs</span>
              )}
              <PersonRef
                person={people[group.holder]}
                fallback={group.holder}
              />{' '}
              <span className="text-muted">
                ({kindWord(group.kinds, group.keys.length)}
                {group.origins.size > 0 &&
                  `, ${plural(group.origins.size, 'origin')}`}
                )
              </span>
            </span>
          ))}
        </p>
      </div>
      <div className="grid gap-px border-t border-border bg-border lg:grid-cols-2">
        {byHolder.groups.map((group) => (
          <div key={group.holder} className="bg-canvas px-3 py-2.5">
            <p className="field-label">
              Says{' '}
              <span className="normal-case tracking-normal text-body">
                {people[group.holder]?.label ?? group.holder}
              </span>{' '}
              held it
            </p>
            <div className="mt-1.5 space-y-1.5">
              {group.keys.length === 0 && (
                <p className="text-xs text-muted">No statement listed.</p>
              )}
              {group.keys.map((key) => (
                <EvidenceRow key={key} evidenceKey={key} showText={showText} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {byHolder.other.length > 0 && (
        <div className="border-t border-border px-3 py-2.5">
          <p className="field-label">Also cited</p>
          <div className="mt-1.5 space-y-1.5">
            {byHolder.other.map((key) => (
              <EvidenceRow key={key} evidenceKey={key} showText={showText} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Denial({ item, showText }: { item: Contrary; showText: boolean }) {
  const { people } = useFindingTables()
  const [left, right] = item.holders
  return (
    <div className="rounded-lg border border-border bg-surface/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="neutral">Denial on file</Chip>
        <span className="text-sm text-body">
          <PersonRef person={people[left]} fallback={left} />
          <span className="mx-2 text-muted">and</span>
          <PersonRef person={people[right]} fallback={right} />
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {item.evidence.map((key) => (
          <EvidenceRow key={key} evidenceKey={key} showText={showText} />
        ))}
      </div>
    </div>
  )
}
