import { useState } from 'react'

import type { Artifact } from '../../api/investigation'
import { formatLocator } from '../../lib/format'
import { Button, KindLabel, Chip } from './shared'
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

const INTEGRITY: Record<Artifact['integrity'], { text: string; bad: boolean }> =
  {
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
      <div className="border-l-2 border-line px-3 py-1.5 text-xs text-muted">
        Statement <span className="font-mono">{evidenceKey}</span> is referenced
        but not included in this response.
      </div>
    )
  }

  const record = item.kind === 'record'
  const family = item.family ? families[item.family] : null
  const artifact =
    item.document && artifacts
      ? artifacts.get(item.document.filename)
      : undefined
  const integrity = artifact ? INTEGRITY[artifact.integrity] : null
  const review = reviewText(item.review)

  if (compact) {
    return (
      <div
        className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 border-l-2 py-1 pl-3 pr-1 ${
          record ? 'border-line' : 'border-dashed border-line'
        } ${item.active ? '' : 'opacity-60'}`}
      >
        <KindLabel kind={item.kind} />
        <span className="min-w-0 flex-1 text-xs leading-snug text-body">
          {item.summary}
        </span>
        <span className="font-mono text-xs text-muted">
          {item.document?.filename ?? 'original not named'} ·{' '}
          {formatLocator(item.locator)}
        </span>
        {review.decided && <Chip tone="signal">{review.text}</Chip>}
        {!item.active && <Chip tone="muted">Not counted here</Chip>}
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
    )
  }

  return (
    <div
      data-kind={item.kind}
      className={`evidence-row ${item.active ? '' : 'opacity-60'}`}
    >
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1">
        <KindLabel kind={item.kind} />
        <p className="min-w-0 flex-1 text-sm leading-snug text-heading">
          {item.summary}
          {note && <span className="ml-2 text-xs text-muted">{note}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {review.decided && <Chip tone="signal">{review.text}</Chip>}
          {!item.active && (
            <Chip
              tone="muted"
              title="Excluded, disputed or rejected: this statement does not count as support here."
            >
              Not counted here
            </Chip>
          )}
        </div>
      </div>

      {showText && (
        <blockquote className="evidence-quote">
          <span aria-hidden="true" className="text-muted">
            “
          </span>
          {item.text || (
            <span className="italic text-muted">no text captured</span>
          )}
          <span aria-hidden="true" className="text-muted">
            ”
          </span>
        </blockquote>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
        <span className="font-mono text-body">
          {item.document?.filename ?? 'original not named'}
        </span>
        {item.document && <span className="numeric">{item.document.case}</span>}
        <span className="numeric">{formatLocator(item.locator)}</span>
        {item.document?.source_org && <span>{item.document.source_org}</span>}
        <span className={integrity?.bad ? 'text-sev-high' : undefined}>
          {integrity ? integrity.text : 'Integrity not checked'}
        </span>
        {!review.decided && <span>{review.text}</span>}
      </div>

      {(family || item.lineage) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          {family && (
            <span>
              <span className="field-label mr-1.5">Origin</span>
              {family.label}
            </span>
          )}
          {item.lineage && (
            <span title={item.lineage.note}>
              {lineageText(item.lineage)}
              {item.lineage.note && (
                <span className="text-muted"> ({item.lineage.note})</span>
              )}
            </span>
          )}
        </div>
      )}

      {allowReview && !reviewing && (
        <Button
          variant="link"
          className="mt-0.5"
          onClick={() => setReviewing(true)}
        >
          Review this passage
        </Button>
      )}
      {reviewing && (
        <AssertionReviewForm
          assertion={item.key}
          onClose={() => setReviewing(false)}
        />
      )}
    </div>
  )
}
