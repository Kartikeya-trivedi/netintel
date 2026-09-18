import { useState } from 'react'

import type { Artifact } from '../../api/investigation'
import { formatLocator } from '../../lib/format'
import { ActionButton, KindLabel, Tag } from './Controls'
import { AssertionReviewForm } from './DecisionForms'
import { useFindingTables } from './FindingTables'
import { lineageText, reviewText } from './model'

/** One statement, traced to the exact words or row it was read from.
 *
 *  Three states are kept apart on purpose: the integrity of the original
 *  (is the file what was received), the analyst's review (has a person
 *  checked it), and whether it counts as support in this view. They answer
 *  different questions and a green light on one says nothing about the others.
 */

const INTEGRITY: Record<Artifact['integrity'], { text: string; bad: boolean }> = {
  intact: { text: 'Original intact', bad: false },
  missing: { text: 'Original missing', bad: true },
  altered: { text: 'Original altered', bad: true },
}

export default function EvidenceRow({
  evidenceKey,
  showText = true,
  allowReview = true,
  compact = false,
  note,
}: {
  evidenceKey: string
  showText?: boolean
  allowReview?: boolean
  /** One line: for a statement already quoted in full just above. */
  compact?: boolean
  /** Why this row is here, when the list around it does not say. */
  note?: string
}) {
  const { evidence, families, artifacts } = useFindingTables()
  const [reviewing, setReviewing] = useState(false)
  const item = evidence[evidenceKey]

  if (!item) {
    return (
      <div className="border-l-2 border-ink-800 px-3 py-1.5 text-[12px] text-ink-500">
        Statement <span className="font-mono">{evidenceKey}</span> is referenced but not included in this response.
      </div>
    )
  }

  const record = item.kind === 'record'
  const family = item.family ? families[item.family] : null
  const artifact = item.document && artifacts ? artifacts.get(item.document.filename) : undefined
  const integrity = artifact ? INTEGRITY[artifact.integrity] : null
  const review = reviewText(item.review)

  if (compact) {
    return (
      <div
        className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 border-l-2 py-1 pl-3 pr-1 ${
          record ? 'border-ink-800' : 'border-dashed border-ink-800'
        } ${item.active ? '' : 'opacity-60'}`}
      >
        <KindLabel kind={item.kind} />
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink-200">{item.summary}</span>
        <span className="font-mono text-[10.5px] text-ink-500">
          {item.document?.filename ?? 'original not named'} · {formatLocator(item.locator)}
        </span>
        {review.decided && <Tag tone="signal">{review.text}</Tag>}
        {!item.active && <Tag tone="muted">Not counted here</Tag>}
        {note && <span className="text-[10.5px] text-ink-500">{note}</span>}
      </div>
    )
  }

  return (
    <div
      className={`border-l-2 py-1.5 pl-3 pr-1 ${
        record ? 'border-ink-700' : 'border-dashed border-ink-700'
      } ${item.active ? '' : 'opacity-60'}`}
    >
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1">
        <KindLabel kind={item.kind} />
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-100">
          {item.summary}
          {note && <span className="ml-2 text-[11px] text-ink-500">{note}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {review.decided && <Tag tone="signal">{review.text}</Tag>}
          {!item.active && (
            <Tag tone="muted" title="Excluded, disputed or rejected: this statement does not count as support here.">
              Not counted here
            </Tag>
          )}
        </div>
      </div>

      {showText && (
        <blockquote className="mt-1 break-words font-mono text-[11.5px] leading-relaxed text-ink-400">
          <span aria-hidden="true" className="text-ink-700">
            “
          </span>
          {item.text || <span className="italic text-ink-500">no text captured</span>}
          <span aria-hidden="true" className="text-ink-700">
            ”
          </span>
        </blockquote>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-500">
        <span className="font-mono text-ink-400">{item.document?.filename ?? 'original not named'}</span>
        {item.document && <span className="readout">{item.document.case}</span>}
        <span className="readout">{formatLocator(item.locator)}</span>
        {item.document?.source_org && <span>{item.document.source_org}</span>}
        <span className={integrity?.bad ? 'text-sev-high' : undefined}>
          {integrity ? integrity.text : 'Integrity not checked'}
        </span>
        {!review.decided && <span>{review.text}</span>}
      </div>

      {(family || item.lineage) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-500">
          {family && (
            <span>
              <span className="legend mr-1.5">Origin</span>
              {family.label}
            </span>
          )}
          {item.lineage && (
            <span title={item.lineage.note}>
              {lineageText(item.lineage)}
              {item.lineage.note && <span className="text-ink-700"> ({item.lineage.note})</span>}
            </span>
          )}
        </div>
      )}

      {allowReview && !reviewing && (
        <ActionButton variant="link" className="mt-0.5" onClick={() => setReviewing(true)}>
          Review this passage
        </ActionButton>
      )}
      {reviewing && <AssertionReviewForm assertion={item.key} onClose={() => setReviewing(false)} />}
    </div>
  )
}
