import { useMemo, type ReactNode } from 'react'

import type { EntityType, Mention } from '../api/types'

const SPAN_COLORS: Record<string, string> = {
  PERSON: 'decoration-ent-person',
  ORG: 'decoration-ent-org',
  LOCATION: 'decoration-ent-location',
  PHONE: 'decoration-ent-phone',
  BANK_ACCOUNT: 'decoration-ent-account',
  VEHICLE: 'decoration-ent-vehicle',
  WEAPON: 'decoration-ent-contraband',
  DRUG: 'decoration-ent-contraband',
}

/** Report text with every extracted mention marked in place.
 *
 *  Underlines rather than highlight blocks: a report where half the words sit
 *  in coloured boxes stops being readable as prose, and the point is to let an
 *  investigator read the source and see the extraction at the same time.
 */
export default function HighlightedText({
  text,
  mentions,
  typeByEntity,
  activeEntityId,
  onSelect,
}: {
  text: string
  mentions: Mention[]
  typeByEntity?: Map<number, EntityType>
  activeEntityId?: number | null
  onSelect?: (entityId: number) => void
}) {
  const parts = useMemo<ReactNode[]>(() => {
    // Sorted and walked once, so overlapping or out-of-order spans from the
    // extractor cannot corrupt the output.
    const sorted = [...mentions].sort((a, b) => a.span_start - b.span_start)
    const output: ReactNode[] = []
    let cursor = 0

    for (const mention of sorted) {
      if (mention.span_start < cursor) continue
      if (mention.span_start > cursor) {
        output.push(text.slice(cursor, mention.span_start))
      }

      const entityType = typeByEntity?.get(mention.entity_id)
      const decoration = entityType
        ? SPAN_COLORS[entityType]
        : 'decoration-muted'
      const active = activeEntityId === mention.entity_id

      output.push(
        <button
          type="button"
          key={mention.id}
          onClick={() => onSelect?.(mention.entity_id)}
          aria-pressed={active}
          title={`${entityType?.replace(/_/g, ' ') ?? 'Entity'} · ${mention.surface_text}`}
          className={`inline min-h-6 cursor-pointer rounded-sm px-0.5 text-left underline decoration-2 underline-offset-[3px] transition-colors ${decoration} ${
            active
              ? 'bg-primary/25 text-heading'
              : 'text-heading hover:bg-subtle'
          }`}
        >
          {text.slice(mention.span_start, mention.span_end)}
        </button>,
      )
      cursor = mention.span_end
    }

    output.push(text.slice(cursor))
    return output
  }, [text, mentions, typeByEntity, activeEntityId, onSelect])

  return (
    <p className="whitespace-pre-wrap text-sm leading-[1.95] text-body">
      {parts}
    </p>
  )
}
