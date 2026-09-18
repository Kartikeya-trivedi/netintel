import { Fragment } from 'react'

import type { Explanation, Step } from '../../api/investigation'
import { LEGEND } from './Controls'
import { useFindingTables } from './FindingTables'
import { EDGE_VERB, hopTypes } from './model'

/** A chain drawn as a route: people as labelled plates with their case codes,
 *  hops as rules between them.
 *
 *  A relationship hop is a solid rule labelled with what it rests on (calls,
 *  transfers, a report claim, and which way they ran). An identity hop is a
 *  dashed rule once accepted and a dotted one while unreviewed, because it is
 *  an assumption joining two case references, not something that happened.
 *  A contested hop says "contested" in words as well as in colour.
 */

const ARROW = { forward: '→', backward: '←', both: '↔', none: '' } as const

function hopLabel(step: Step): { text: string; spoken: string; claimOnly: boolean } {
  const types = hopTypes(step)
  const text = types.map((t) => `${EDGE_VERB[t.type]}${ARROW[t.direction] ? ` ${ARROW[t.direction]}` : ''}`).join(' · ')
  const spoken = types
    .map((t) => {
      const verb = EDGE_VERB[t.type]
      if (t.direction === 'both') return `${verb} both ways`
      if (t.direction === 'forward') return `${verb} left to right`
      if (t.direction === 'backward') return `${verb} right to left`
      return verb
    })
    .join(', ')
  const claimOnly = types.length > 0 && types.every((t) => t.type === 'CLAIMED')
  return { text, spoken, claimOnly }
}

export default function ChainDiagram({ explanation }: { explanation: Explanation }) {
  const { people } = useFindingTables()
  const nodes = explanation.nodes.length
    ? explanation.nodes
    : [explanation.steps[0]?.source, ...explanation.steps.map((s) => s.target)].filter(
        (key): key is string => Boolean(key),
      )

  const spoken = explanation.steps
    .map((step) => {
      const a = people[step.source]
      const b = people[step.target]
      const left = a ? `${a.label} (${a.case})` : step.source
      const right = b ? `${b.label} (${b.case})` : step.target
      if (step.identity) {
        return `${left} treated as the same person as ${right}, ${step.provisional ? 'unreviewed' : 'accepted'}`
      }
      return `${left} to ${right}: ${hopLabel(step).spoken}${step.contested ? ', contested by a record' : ''}`
    })
    .join('; ')

  return (
    <figure>
      <figcaption className="sr-only">Chain: {spoken}.</figcaption>
      <ol aria-hidden="true" className="relative flex items-stretch overflow-x-auto pb-1">
        {nodes.map((key, index) => {
          const person = people[key]
          const step = index > 0 ? explanation.steps[index - 1] : null
          return (
            <Fragment key={`${key}-${index}`}>
              {step && <Hop step={step} />}
              <li className="flex shrink-0">
                <div
                  className={`flex min-w-[112px] flex-col justify-center border bg-ink-950 px-2.5 py-1.5 ${
                    person?.hub ? 'border-dashed border-status-lead/70' : 'hairline'
                  }`}
                >
                  <span className="text-[12.5px] font-medium leading-tight text-ink-100">{person?.label ?? key}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5">
                    <span className="readout text-[10.5px] text-ink-500">{person?.case ?? '—'}</span>
                    {person?.accused && <span className={`${LEGEND} text-ink-500`}>accused</span>}
                  </span>
                  {person?.hub && (
                    <span className="mt-0.5 font-cond text-[9.5px] font-semibold uppercase tracking-[0.08em] text-status-lead">
                      high-activity contact
                    </span>
                  )}
                </div>
              </li>
            </Fragment>
          )
        })}
      </ol>
    </figure>
  )
}

function Hop({ step }: { step: Step }) {
  if (step.identity) {
    return (
      <li className="flex min-w-[92px] flex-1 flex-col justify-center px-1.5">
        <span className="text-center font-cond text-[10px] font-semibold uppercase tracking-[0.08em] text-status-lead">
          {step.provisional ? 'same person? unreviewed' : 'same person, accepted'}
        </span>
        <span
          className={`my-1 block border-t-2 ${
            step.provisional ? 'border-dotted border-status-lead' : 'border-dashed border-ink-500'
          }`}
        />
        <span className="text-center text-[10px] text-ink-500">identity assumption</span>
      </li>
    )
  }
  const label = hopLabel(step)
  return (
    <li className="flex min-w-[104px] flex-1 flex-col justify-center px-1.5">
      <span className="text-center font-cond text-[10.5px] font-semibold tracking-[0.04em] text-ink-400">
        {label.text || 'relationship'}
      </span>
      <span
        className={`my-1 block border-t-2 ${step.contested ? 'border-signal' : 'border-ink-500'} ${
          label.claimOnly ? 'opacity-60' : ''
        }`}
      />
      <span className="text-center text-[10px]">
        {step.contested ? (
          <span className="font-cond font-semibold uppercase tracking-[0.08em] text-signal">contested</span>
        ) : label.claimOnly ? (
          <span className="text-ink-500">claim only</span>
        ) : (
          <span aria-hidden="true">&nbsp;</span>
        )}
      </span>
    </li>
  )
}
