import { useMemo, useState } from 'react'

import type { Contrary, FindingDetail } from '../../api/investigation'
import { formatRange, plural } from '../../lib/format'
import { EmptyPanel, Segmented } from '../Instrument'
import CandidateCard from './CandidateCard'
import { ActionButton, Note, PersonRef, SectionHeading, Tag } from './Controls'
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
            <div className="flex flex-wrap items-center gap-3">
              <ActionButton variant="link" onClick={() => setFold({ open: true, nonce: Date.now() })}>
                Expand all
              </ActionButton>
              <ActionButton variant="link" onClick={() => setFold({ open: false, nonce: Date.now() })}>
                Collapse all
              </ActionButton>
              <span className="flex items-center gap-2">
                <span className="legend">Original text</span>
                <Segmented
                  options={[
                    { value: 'shown' as const, label: 'Shown' },
                    { value: 'hidden' as const, label: 'Hidden' },
                  ]}
                  value={text}
                  onChange={setText}
                />
              </span>
            </div>
          }
        >
          Each explanation is one chain of people. Every relationship in it lists the statements it was derived
          from, quoted from the original. {detail.paths_found > detail.explanations.length &&
            `${plural(detail.paths_found, 'path')} were found and grouped into these chains.`}
          {detail.truncated && ' More chains exist than are shown here.'}
        </SectionHeading>

        {detail.explanations.length === 0 ? (
          <EmptyPanel title="No explanation within the search scope">
            No chain of people joins the two within the current hop limit and decisions.
          </EmptyPanel>
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

      <ContrarySection contrary={detail.contrary} detail={detail} showText={showText} />

      <section className="space-y-3">
        <SectionHeading title={`Identity candidates · ${detail.candidates.length}`}>
          Case references this finding joins on the assumption that they are one person. A shared name is a
          proposal to review, not a conclusion.
        </SectionHeading>
        {detail.candidates.length === 0 ? (
          <Note>This finding rests on no identity proposal: every hop stays within one case reference.</Note>
        ) : (
          <div className="space-y-2">
            {detail.candidates.map((candidate) => (
              <CandidateCard key={candidate.key} candidate={candidate} showText={showText} />
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
        Statements that pull against this finding: the same number attributed to different people over the
        same days, and denials on file.
      </SectionHeading>
      {contrary.length === 0 ? (
        <Note>Nothing on file contradicts the statements this finding uses.</Note>
      ) : (
        <ul className="space-y-3">
          {contrary.map((item, index) => (
            <li key={`${item.kind}-${item.identifier ?? ''}-${index}`}>
              {item.kind === 'attribution' ? (
                <AttributionConflict item={item} detail={detail} showText={showText} />
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
function AttributionConflict({ item, detail, showText }: { item: Contrary; detail: FindingDetail; showText: boolean }) {
  const { people, evidence } = useFindingTables()

  // The timeline's holdings say who each holding statement names, which is
  // how the evidence list is split between the holders.
  const byHolder = useMemo(() => {
    const holdingPerson = new Map(detail.timeline.holdings.map((h) => [h.key, h.person]))
    const assigned = new Set<string>()
    const groups = item.holders.map((holder) => {
      const label = people[holder]?.label
      const keys = item.evidence.filter((key) => label !== undefined && holdingPerson.get(key) === label)
      keys.forEach((key) => assigned.add(key))
      const kinds = new Set(keys.map((key) => evidence[key]?.kind).filter(Boolean))
      const origins = new Set(keys.map((key) => evidence[key]?.family).filter(Boolean))
      return { holder, keys, kinds, origins }
    })
    const other = item.evidence.filter((key) => !assigned.has(key))
    return { groups, other }
  }, [detail.timeline.holdings, evidence, item.evidence, item.holders, people])

  function kindWord(kinds: Set<string | undefined>, count: number): string {
    if (count === 0) return 'no holding statement listed'
    if (kinds.size > 1) return `${plural(count, 'statement')}, records and claims`
    const kind = [...kinds][0] === 'record' ? 'record' : 'claim'
    return plural(count, kind)
  }

  return (
    <div className="border hairline bg-ink-950/60">
      <div className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="signal">Attribution conflict</Tag>
          <span className="readout text-[13px] text-ink-100">{item.identifier ?? 'identifier not stated'}</span>
          <span className="text-[12.5px] text-ink-400">
            {formatRange(item.from, item.to)}
            {item.events !== undefined && ` · ${plural(item.events, 'event')} read as more than one person`}
          </span>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-200">
          {byHolder.groups.map((group, index) => (
            <span key={group.holder}>
              {index > 0 && <span className="mx-2 font-cond text-[11px] uppercase tracking-[0.12em] text-signal">vs</span>}
              <PersonRef person={people[group.holder]} fallback={group.holder} />{' '}
              <span className="text-ink-500">
                ({kindWord(group.kinds, group.keys.length)}
                {group.origins.size > 0 && `, ${plural(group.origins.size, 'origin')}`})
              </span>
            </span>
          ))}
        </p>
      </div>
      <div className="grid gap-px border-t hairline gap-fill lg:grid-cols-2">
        {byHolder.groups.map((group) => (
          <div key={group.holder} className="bg-ink-1000 px-3 py-2.5">
            <p className="legend">
              Says <span className="normal-case tracking-normal text-ink-200">{people[group.holder]?.label ?? group.holder}</span>{' '}
              held it
            </p>
            <div className="mt-1.5 space-y-1.5">
              {group.keys.length === 0 && <p className="text-[12px] text-ink-500">No statement listed.</p>}
              {group.keys.map((key) => (
                <EvidenceRow key={key} evidenceKey={key} showText={showText} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {byHolder.other.length > 0 && (
        <div className="border-t hairline px-3 py-2.5">
          <p className="legend">Also cited</p>
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
    <div className="border hairline bg-ink-950/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="neutral">Denial on file</Tag>
        <span className="text-[13px] text-ink-200">
          <PersonRef person={people[left]} fallback={left} />
          <span className="mx-2 text-ink-500">and</span>
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
