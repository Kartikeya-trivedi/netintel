import { useState } from 'react'

import type { CandidateOut } from '../../api/investigation'
import { plural } from '../../lib/format'
import { ActionButton, PersonRef, Tag } from './Controls'
import { IdentityDecisionForm } from './DecisionForms'
import EvidenceRow from './EvidenceRow'
import { useFindingTables } from './FindingTables'
import { CANDIDATE_STATUS } from './model'

/** Two case references that might be one person, and what that rests on.
 *
 *  A same-name match is a proposal, never a conclusion. The card says what the
 *  proposal was made on (the name, and any identifier both references used)
 *  and whether those uses overlapped in time: a number that passed from one
 *  holder to another is not evidence the two holders are the same person.
 */
export default function CandidateCard({
  candidate,
  showText = true,
  compact = false,
}: {
  candidate: CandidateOut
  showText?: boolean
  compact?: boolean
}) {
  const { people } = useFindingTables()
  const [deciding, setDeciding] = useState(false)
  const [open, setOpen] = useState(!compact)
  const reviewed = candidate.status !== 'proposed'

  return (
    <div className="border hairline bg-ink-950/60">
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] text-ink-100">
            <PersonRef person={people[candidate.a]} fallback={candidate.a} />
            <span className="mx-2 text-ink-500" aria-hidden="true">
              ≟
            </span>
            <span className="sr-only"> may be the same person as </span>
            <PersonRef person={people[candidate.b]} fallback={candidate.b} />
          </p>
          <p className="mt-1 text-[12px] text-ink-500">
            Proposed on {candidate.name_match ? 'the same name' : 'shared identifiers'}
            {candidate.shared.length > 0
              ? ` and ${plural(candidate.shared.length, 'shared identifier')}`
              : candidate.name_match
                ? ' alone — no identifier in common'
                : ''}
            .{' '}
            {candidate.in_effect
              ? 'Currently used to join routes.'
              : 'Not used to join routes under the current decisions.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Tag tone={reviewed ? 'signal' : 'lead'}>{CANDIDATE_STATUS[candidate.status]}</Tag>
          {candidate.provisional && !reviewed && <Tag tone="lead">Unconfirmed</Tag>}
        </div>
      </div>

      {candidate.shared.length > 0 && (
        <div className="border-t hairline px-3 py-2">
          {compact && (
            <ActionButton variant="link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide shared identifiers' : `Show ${plural(candidate.shared.length, 'shared identifier')}`}
            </ActionButton>
          )}
          {open && (
            <ul className="mt-1 space-y-3">
              {candidate.shared.map((shared) => (
                <li key={shared.identifier}>
                  <p className="text-[12px] text-ink-200">
                    <span className="readout text-ink-100">{shared.identifier}</span>
                    <span className="ml-2">
                      {shared.overlapping ? (
                        <Tag tone="neutral">Used by both at the same time</Tag>
                      ) : (
                        <Tag tone="lead" title="Each reference used it, but never during the same period.">
                          Held at different times — no overlap
                        </Tag>
                      )}
                    </span>
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {shared.evidence.map((key) => (
                      <EvidenceRow key={key} evidenceKey={key} showText={showText} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="border-t hairline px-3 py-2">
        {!deciding ? (
          <ActionButton onClick={() => setDeciding(true)}>Record identity decision</ActionButton>
        ) : (
          <IdentityDecisionForm candidate={candidate} onClose={() => setDeciding(false)} />
        )}
      </div>
    </div>
  )
}
