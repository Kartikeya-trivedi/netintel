import type { ReactNode } from 'react'

import type { Mention } from '../api/types'

/** Renders report text with entity mentions highlighted in place.
 *
 *  Spans are sorted and walked once, so overlapping or out-of-order mentions
 *  from the extractor cannot corrupt the output.
 */
export default function HighlightedText({
  text,
  mentions,
  onSelect,
}: {
  text: string
  mentions: Mention[]
  onSelect?: (entityId: number) => void
}) {
  const sorted = [...mentions].sort((a, b) => a.span_start - b.span_start)
  const parts: ReactNode[] = []
  let cursor = 0

  for (const mention of sorted) {
    if (mention.span_start < cursor) continue
    if (mention.span_start > cursor) {
      parts.push(text.slice(cursor, mention.span_start))
    }
    parts.push(
      <mark
        key={mention.id}
        onClick={() => onSelect?.(mention.entity_id)}
        className="cursor-pointer rounded bg-accent/20 px-0.5 text-console-200 hover:bg-accent/35"
      >
        {text.slice(mention.span_start, mention.span_end)}
      </mark>,
    )
    cursor = mention.span_end
  }
  parts.push(text.slice(cursor))

  return <p className="whitespace-pre-wrap leading-relaxed text-console-200">{parts}</p>
}
