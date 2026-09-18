import { useMemo } from 'react'

import type { FindingDetail } from '../../api/investigation'
import { Legend } from '../Instrument'
import ChainDiagram from './ChainDiagram'
import { SectionHeading } from './Controls'
import EvidenceRow from './EvidenceRow'
import StatusBadge from './StatusBadge'
import TimelineLanes from './TimelineLanes'

/** Surface 2: the typed relationships as routes, and their valid times.
 *
 *  The timeline is where a re-issued number shows itself: a record bar for
 *  one holder ending, another starting, and the calls landing after the
 *  change while a claim still names the earlier holder.
 */
export default function NetworkTimeSurface({ detail }: { detail: FindingDetail }) {
  // Holding statements the identity comparison cites that the timeline does
  // not place. They are listed rather than drawn: a record's end date is not
  // in the response, and a bar drawn open-ended would say the wrong thing.
  const unplaced = useMemo(() => {
    const placed = new Set(detail.timeline.holdings.map((holding) => holding.key))
    const out = new Map<string, string[]>()
    for (const candidate of detail.candidates) {
      for (const shared of candidate.shared) {
        for (const key of shared.evidence) {
          const item = detail.evidence[key]
          if (placed.has(key) || !item || item.predicate !== 'HOLDS') continue
          const list = out.get(shared.identifier) ?? []
          if (!list.includes(key)) list.push(key)
          out.set(shared.identifier, list)
        }
      }
    }
    return [...out.entries()]
  }, [detail.candidates, detail.evidence, detail.timeline.holdings])

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeading title={`Chains · ${detail.explanations.length}`}>
          Each explanation as a route. Solid rules are relationships read from the originals; a dotted rule is an
          unreviewed identity assumption, a dashed one an accepted identity.
        </SectionHeading>
        {detail.explanations.length === 0 ? (
          <p className="text-[12.5px] text-ink-500">No chain within the search scope.</p>
        ) : (
          <ol className="space-y-3">
            {detail.explanations.map((explanation, index) => (
              <li key={explanation.key} className="border hairline bg-ink-950/60 px-3 py-2.5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Legend>Explanation {index + 1}</Legend>
                  <StatusBadge status={explanation.status} />
                </div>
                <ChainDiagram explanation={explanation} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeading title="Who held what, when">
          One lane per number or account. Bars say who held it and when; ticks are the calls and transfers this
          finding uses, collapsed to one per day. Times are Indian Standard Time.
        </SectionHeading>
        <TimelineLanes timeline={detail.timeline} contrary={detail.contrary} />

        {unplaced.length > 0 && (
          <div className="space-y-2 border hairline bg-ink-950/60 px-3 py-2.5">
            <Legend>Also on file, not placed on this timeline</Legend>
            <p className="text-[12px] text-ink-500">
              The identity comparison cites these holding statements for the same identifiers, but the timeline
              in this response does not include them. Read them here; their dates are in each summary.
            </p>
            {unplaced.map(([identifier, keys]) => (
              <div key={identifier}>
                <p className="readout text-[12px] text-ink-200">{identifier}</p>
                <div className="mt-1 space-y-1.5">
                  {keys.map((key) => (
                    <EvidenceRow key={key} evidenceKey={key} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
